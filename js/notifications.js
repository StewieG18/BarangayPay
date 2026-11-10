
(() => {
    "use strict";

    const client = window.supabaseClient;
    const BP = window.BP;

    if (!client || !BP) {
        console.error("Notifications: Supabase or BP is not initialized.");
        return;
    }

    const staffButton = document.getElementById("staffNotificationButton");
    const residentButton = document.querySelector(".notification-button");
    const button = staffButton || residentButton;

    if (!button) {
        console.error("Notification button not found.");
        return;
    }

    const isStaff = Boolean(staffButton);

    const destination = isStaff
        ? BP.url("Staff/StaffRequests/requests.html")
        : BP.url("MyTransactions/transactions.html");

    // Change this path if you create a dedicated notifications page.
    const allNotificationsPage = isStaff
        ? BP.url("Staff/StaffNotifications/notifications.html")
        : BP.url("Notifications/notifications.html");

    let currentUser = null;
    let notifications = [];
    let channel = null;

    // Create notification dropdown
    const wrapper = document.createElement("div");
    wrapper.className = "bp-notification-wrapper";

    button.parentNode.insertBefore(wrapper, button);
    wrapper.appendChild(button);

    const badge = document.createElement("span");
    badge.className = "bp-notification-count";
    badge.hidden = true;
    button.appendChild(badge);

    const panel = document.createElement("section");
    panel.className = "bp-notification-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Notifications");

    panel.innerHTML = `
        <div class="bp-notification-header">
            <strong>Notifications</strong>
            <button type="button" class="bp-mark-all">
                Mark all read
            </button>
        </div>

        <div class="bp-notification-list">
            <p class="bp-notification-empty">Loading notifications...</p>
        </div>

        <div class="bp-notification-footer">
            <a href="#" class="bp-see-more">See More</a>
        </div>
    `;

    wrapper.appendChild(panel);

    const list = panel.querySelector(".bp-notification-list");
    const markAllButton = panel.querySelector(".bp-mark-all");
    const seeMoreButton = panel.querySelector(".bp-see-more");

    button.setAttribute("aria-expanded", "false");

    function formatTime(value) {
        if (!value) return "";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return "";

        return date.toLocaleString("en-PH", {
            dateStyle: "medium",
            timeStyle: "short"
        });
    }

    function updateCount() {
        const unread = notifications.filter(item => !item.read_at).length;

        badge.textContent = unread > 99 ? "99+" : String(unread);
        badge.hidden = unread === 0;

        const indicator = button.querySelector(
            ".notification-indicator, .staff-notification-indicator"
        );

        if (indicator) {
            indicator.style.display = unread > 0 ? "block" : "none";
        }

        button.setAttribute(
            "aria-label",
            unread > 0
                ? `Notifications, ${unread} unread`
                : "Notifications"
        );
    }

    function renderNotifications() {
        list.replaceChildren();

        // Show only the five most recent notifications.
        const recentNotifications = notifications.slice(0, 5);

        if (recentNotifications.length === 0) {
            const empty = document.createElement("p");
            empty.className = "bp-notification-empty";
            empty.textContent = "No notifications yet.";
            list.appendChild(empty);
        } else {
            recentNotifications.forEach(notification => {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "bp-notification-item";

                if (!notification.read_at) {
                    item.classList.add("unread");
                }

                const title = document.createElement("strong");
                title.textContent = notification.title;

                const message = document.createElement("span");
                message.textContent = notification.message;

                const time = document.createElement("small");
                time.textContent = formatTime(notification.created_at);

                item.append(title, message, time);

                item.addEventListener("click", async () => {
                    if (!notification.read_at) {
                        const readAt = new Date().toISOString();

                        const { error } = await client
                            .from("notifications")
                            .update({ read_at: readAt })
                            .eq("id", notification.id)
                            .eq("recipient_id", currentUser.id);

                        if (error) {
                            console.error("Could not mark notification as read:", error);
                            return;
                        }

                        notification.read_at = readAt;
                        updateCount();
                        renderNotifications();
                    }

                    window.location.href = destination;
                });

                list.appendChild(item);
            });
        }

        updateCount();
    }

    async function loadNotifications() {
        const { data, error } = await client
            .from("notifications")
            .select(`
                id,
                request_id,
                notification_type,
                title,
                message,
                read_at,
                created_at
            `)
            .eq("recipient_id", currentUser.id)
            .order("created_at", { ascending: false })
            .limit(30);

        if (error) {
            console.error("Could not load notifications:", error);
            list.textContent = "Unable to load notifications.";
            return;
        }

        notifications = data || [];
        renderNotifications();
    }

    async function markAllAsRead() {
        const unread = notifications.filter(item => !item.read_at);

        if (unread.length === 0) return;

        const readAt = new Date().toISOString();

        const { error } = await client
            .from("notifications")
            .update({ read_at: readAt })
            .eq("recipient_id", currentUser.id)
            .is("read_at", null);

        if (error) {
            console.error("Could not mark notifications as read:", error);
            return;
        }

        notifications.forEach(item => {
            if (!item.read_at) item.read_at = readAt;
        });

        renderNotifications();
    }

    function subscribeToNotifications() {
        channel = client
            .channel(`notifications-${currentUser.id}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "notifications",
                    filter: `recipient_id=eq.${currentUser.id}`
                },
                payload => {
                    const incoming = payload.new;

                    if (!notifications.some(item => item.id === incoming.id)) {
                        notifications.unshift(incoming);
                        notifications = notifications.slice(0, 30);
                        renderNotifications();
                    }
                }
            )
            .subscribe();
    }

    // Bell always toggles, regardless of notification count.
    button.addEventListener("click", event => {
        event.stopPropagation();

        panel.hidden = !panel.hidden;

        button.setAttribute(
            "aria-expanded",
            String(!panel.hidden)
        );
    });

    panel.addEventListener("click", event => {
        event.stopPropagation();
    });

    document.addEventListener("click", () => {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
    });

    markAllButton.addEventListener("click", markAllAsRead);

    // Open complete notification history.
    seeMoreButton.addEventListener("click", event => {
        event.preventDefault();
        window.location.href = allNotificationsPage;
    });

    async function initialize() {
        try {
            const auth = await BP.requireRole(
                isStaff ? ["staff", "admin"] : ["resident"]
            );

            if (!auth) return;

            currentUser = auth.user;

            await loadNotifications();
            subscribeToNotifications();

        } catch (error) {
            console.error("Notification initialization failed:", error);
        }
    }

    initialize();

    window.addEventListener("beforeunload", () => {
        if (channel) {
            client.removeChannel(channel);
        }
    });
})();
