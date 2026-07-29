# Payment Failures, Failed Charge Handling & Grace Periods

## Why Payments Fail
Common reasons for subscription renewal failures include:
- Expired credit/debit card numbers.
- Insufficient funds or credit limit exceeded.
- Card issuer fraud prevention blocks on recurring international transactions.
- Outdated billing address or incorrect CVC verification code.

## Automatic Payment Retry Schedule
When an automated invoice payment fails on your renewal date, Deskwise initiates an automated dunning sequence:
- **Day 0 (Initial Failure)**: Automated email notification sent to billing owners. Account remains fully active.
- **Day 3 (1st Retry)**: Automated system retry. Email reminder sent if charge fails.
- **Day 5 (2nd Retry)**: Second system retry attempt.
- **Day 7 (Final Retry)**: Final payment attempt.

## 7-Day Grace Period
We provide a **7-calendar-day grace period** following an initial payment failure. During these 7 days, your support widget, API endpoints, and knowledge base search remain 100% operational without interruption.

## Account Suspension & Lockout
- **Day 8 Post-Failure**: If payment has not been successfully processed by Day 8, the account transitions to **Past Due / Suspended** status.
- **Service Impact**: Search widgets will display a "Service Paused" notice to end users, and API calls will return `402 Payment Required`.
- **Restoration**: Updating your card or paying the open invoice instantly restores all features within 60 seconds without data loss.

## How to Update Payment Details
1. Go to **Settings > Billing & Invoices > Payment Methods**.
2. Click **Add New Card** or **Update Credit Card**.
3. Set the new payment card as **Primary**.
4. Click **Pay Outstanding Invoice** to trigger immediate processing.
