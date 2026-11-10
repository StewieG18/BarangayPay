
(() => {
    "use strict";

    const client = window.supabaseClient;
    const BP = window.BP;

    const page = document.querySelector(".notification-page");

    if (!page || !client || !BP) {
        console.error("Notifications page: Required elements are missing.");
        return;
    }

    const portal = page.dataset.portal;
    const isStaff = portal === "staff";

    const list = document.getElementById("notificationHistoryList");
    const totalElement = document.getElementById("totalNotifications");
    const unreadElement = document.getElementById("unreadNotifications");
    const markAllButton = document.getElementById("markAllNotifications");
    const loadMoreButton = document.getElementById("loadMoreNotifications");
    const filterButtons = document.querySelectorAll(".notification-filter");

    const destination = isStaff
        ? BP.url("Staff/StaffRequests/requests.html")
        : BP.url("MyTransactions/transactions.html");

    const PAGE_SIZE = 20;

    let currentUser = null;
    let notifications = [];
    let currentFilter = "all";
    let currentOffset = 0;
    let hasMore = true;
    let channel = null;
    let loading = false;

    function formatDate(value) {
        if (!value) return "";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return "";

        return date.toLocaleString("en-PH", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function updateSummary() {
        totalElement.textContent = notifications.length;

        unreadElement.textContent =
            notifications.filter(item => !item.read_at).length;
    }

    function renderNotifications() {
        list.replaceChildren();

        const filtered = notifications.filter(item => {
            if (currentFilter === "unread") return !item.read_at;
            if (currentFilter === "read") return Boolean(item.read_at);
            return true;
        });

        if (filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "notification-history-empty";

            const icon = document.createElement("div");
            icon.className = "notification-empty-icon";
            icon.textContent = "🔔";

            const heading = document.createElement("h3");
            heading.textContent = currentFilter === "unread"
                ? "No unread notifications"
                : currentFilter === "read"
                    ? "No read notifications"
                    : "No notifications yet";

            const message = document.createElement("p");
            message.textContent = currentFilter === "all"
                ? "Your notifications will appear here when there are updates."
                : "There are no notifications in this category.";

            empty.append(icon, heading, message);
            list.appendChild(empty);
        } else {
            filtered.forEach(notification => {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "notification-history-item";

                if (!notification.read_at) {
                    item.classList.add("unread");
                }

                const indicator = document.createElement("span");
                indicator.className = "notification-history-dot";

                const content = document.createElement("span");
                content.className = "notification-history-content";

                const title = document.createElement("strong");
                title.textContent = notification.title;

                const message = document.createElement("span");
                message.className = "notification-history-message";
                message.textContent = notification.message;

                const date = document.createElement("small");
                date.textContent = formatDate(notification.created_at);

                content.append(title, message, date);
                item.append(indicator, content);

                item.addEventListener("click", () => {
                    openNotification(notification);
                });

                list.appendChild(item);
            });
        }

        updateSummary();

        loadMoreButton.hidden = !hasMore;
        loadMoreButton.disabled = loading;
        loadMoreButton.textContent = loading
            ? "Loading..."
            : "Load More";
    }

    async function loadNotifications() {
        if (loading || !hasMore) return;

        loading = true;
        renderNotifications();

        try {
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
                .range(currentOffset, currentOffset + PAGE_SIZE - 1);

            if (error) throw error;

            const incoming = data || [];

            notifications.push(...incoming);

            currentOffset += incoming.length;
            hasMore = incoming.length === PAGE_SIZE;

            renderNotifications();

        } catch (error) {
            console.error("Unable to load notifications:", error);

            list.innerHTML = `
                <div class="notification-history-error">
                    Unable to load notifications. Please refresh the page.
                </div>
            `;
        } finally {
            loading = false;
            loadMoreButton.disabled = false;
            loadMoreButton.hidden = !hasMore;
            loadMoreButton.textContent = "Load More";
        }
    }

    async function refreshNotifications() {
        notifications = [];
        currentOffset = 0;
        hasMore = true;

        list.innerHTML = `
            <div class="notification-page-loading">
                Loading notifications...
            </div>
        `;

        await loadNotifications();
    }

    async function openNotification(notification) {
        if (!notification.read_at) {
            const readAt = new Date().toISOString();

            const { error } = await client
                .from("notifications")
                .update({ read_at: readAt })
                .eq("id", notification.id)
                .eq("recipient_id", currentUser.id);

            if (error) {
                console.error("Could not mark notification as read:", error);
                alert("Unable to update notification. Please try again.");
                return;
            }

            notification.read_at = readAt;
            renderNotifications();
        }

        window.location.href = destination;
    }

    async function markAllAsRead() {
        const unread = notifications.filter(item => !item.read_at);

        if (unread.length === 0) {
            alert("There are no unread notifications.");
            return;
        }

        markAllButton.disabled = true;

        try {
            const readAt = new Date().toISOString();

            const { error } = await client
                .from("notifications")
                .update({ read_at: readAt })
                .eq("recipient_id", currentUser.id)
                .is("read_at", null);

            if (error) throw error;

            notifications.forEach(item => {
                if (!item.read_at) {
                    item.read_at = readAt;
                }
            });

            renderNotifications();

        } catch (error) {
            console.error("Could not mark all notifications as read:", error);
            alert("Unable to mark notifications as read.");
        } finally {
            markAllButton.disabled = false;
        }
    }

    function subscribeToNotifications() {
        channel = client
            .channel(`notification-history-${currentUser.id}`)
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

                        // Keep the loaded history in newest-first order.
                        notifications.sort((a, b) =>
                            new Date(b.created_at) - new Date(a.created_at)
                        );

                        renderNotifications();
                    }
                }
            )
            .subscribe();
    }

    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            currentFilter = button.dataset.filter;

            filterButtons.forEach(item => {
                item.classList.toggle("active", item === button);
            });

            renderNotifications();
        });
    });

    markAllButton.addEventListener("click", markAllAsRead);

    loadMoreButton.addEventListener("click", loadNotifications);

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
            console.error("Notification page initialization failed:", error);

            list.textContent =
                "Unable to verify your account. Please sign in again.";
        }
    }

    initialize();

    window.addEventListener("beforeunload", () => {
        if (channel) {
            client.removeChannel(channel);
        }
    });
})();
