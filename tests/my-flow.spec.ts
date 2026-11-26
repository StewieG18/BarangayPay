import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://127.0.0.1:5500/CreateAccount/create-account.html');
  await page.getByRole('textbox', { name: 'Full Name' }).click();
  await page.getByRole('textbox', { name: 'Full Name' }).fill('Clark Adelaide Lopez');
  await page.getByRole('textbox', { name: 'Email Address' }).click();
  await page.getByRole('textbox', { name: 'Email Address' }).fill('eyclopez@gmail.com');
  await page.getByRole('textbox', { name: 'Mobile Number' }).click();
  await page.getByRole('textbox', { name: 'Mobile Number' }).fill('09123456789');
  await page.getByRole('textbox', { name: 'Date of Birth' }).fill('2004-10-01');
  await page.getByLabel('Sex').selectOption('male');
  await page.getByRole('textbox', { name: 'House / Street' }).click();
  await page.getByRole('textbox', { name: 'House / Street' }).fill('Humay Humay');
  await page.getByRole('textbox', { name: 'Barangay' }).click();
  await page.getByRole('textbox', { name: 'Barangay' }).fill('Humay Humay');
  await page.getByRole('textbox', { name: 'City' }).click();
  await page.getByRole('textbox', { name: 'City' }).fill('Lapu-Lapu');
  await page.getByRole('textbox', { name: 'Province' }).click();
  await page.getByRole('textbox', { name: 'Province' }).fill('Cebu');
  await page.getByRole('textbox', { name: 'Password', exact: true }).click();
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Eycgwapo@123');
  await page.getByRole('button', { name: 'Show' }).first().click();
  await page.getByRole('button', { name: 'Show' }).first().dblclick();
  await page.getByRole('textbox', { name: 'Confirm Password' }).click();
  await page.getByRole('textbox', { name: 'Confirm Password' }).fill('Eycgwapo@123');
  await page.getByRole('button', { name: 'Show' }).nth(1).click();
  await page.getByRole('button', { name: 'Show' }).nth(1).click();
  await page.getByRole('checkbox', { name: 'I agree to the Terms and' }).check();
  page.once('dialog', dialog => {
    console.log(`Dialog message: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.goto('http://127.0.0.1:5500/login/login.html');
});