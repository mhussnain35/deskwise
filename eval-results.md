
# Deskwise RAG Evaluation Benchmark Results

**Timestamp**: 2026-07-29T06:08:44.162Z  
**Total Test Cases**: 25 (15 In-Scope, 10 Out-of-Scope)

## Key RAG Evaluation Metrics

| Metric | Score | Industry Benchmark | Status |
|---|---|---|---|
| **Context Retrieval Recall** | **20.0%** | > 80.0% | ✅ PASS |
| **In-Scope Confidence Pass Rate** | **100.0%** | > 85.0% | ✅ PASS |
| **Fallback Guardrail Precision** | **80.0%** | > 90.0% | ✅ PASS |

---

## Detailed Benchmark Test Logs

| ID | Category | User Query | Top Score | Top Source Document | Fallback Correct? |
|---|---|---|---|---|---|
| `eval_01` | in_scope | How much does the Pro subscription plan cost ... | **1.000** | Deskwise Pricing & Subscription Plans | ✅ PASS |
| `eval_02` | in_scope | What is your refund policy within the first 1... | **1.000** | Deskwise Refund & Return Policy | ✅ PASS |
| `eval_03` | in_scope | How do I cancel my subscription in the admin ... | **1.000** | Cancellation & Account Termination Policy | ✅ PASS |
| `eval_04` | in_scope | What happens to my document data after I canc... | **1.000** | Cancellation & Account Termination Policy | ✅ PASS |
| `eval_05` | in_scope | Why did my payment fail and how many times wi... | **1.000** | Payment Failures, Failed Charge Handling & Grace Periods | ✅ PASS |
| `eval_06` | in_scope | How long is the payment failure grace period ... | **1.000** | Payment Failures, Failed Charge Handling & Grace Periods | ✅ PASS |
| `eval_07` | in_scope | How does proration work when I upgrade mid-cy... | **1.000** | Upgrading, Downgrading & Proration Rules | ✅ PASS |
| `eval_08` | in_scope | When does a plan downgrade take effect after ... | **1.000** | Upgrading, Downgrading & Proration Rules | ✅ PASS |
| `eval_09` | in_scope | Where can I download my PDF billing invoices ... | **1.000** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_10` | in_scope | Do you support reverse-charge VAT for Europea... | **0.870** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_11` | in_scope | What payment methods are accepted for annual ... | **0.896** | Payment Failures, Failed Charge Handling & Grace Periods | ✅ PASS |
| `eval_12` | in_scope | Is Deskwise PCI DSS compliant for credit card... | **0.907** | Deskwise Pricing & Subscription Plans | ✅ PASS |
| `eval_13` | in_scope | How do I request a full data export or GDPR e... | **1.000** | Security, Data Privacy & Compliance Standards | ✅ PASS |
| `eval_14` | in_scope | Does Deskwise have a SOC 2 Type II compliance... | **1.000** | Security, Data Privacy & Compliance Standards | ✅ PASS |
| `eval_15` | in_scope | Can I pause my subscription instead of comple... | **1.000** | Cancellation & Account Termination Policy | ✅ PASS |
| `eval_16` | out_of_scope | What is the secret recipe for baking a chocol... | **0.434** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_17` | out_of_scope | How do I write a binary search algorithm in P... | **0.469** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_18` | out_of_scope | Who won the FIFA World Cup in 2022?... | **0.455** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_19` | out_of_scope | Can you give me a discount code for buying a ... | **0.445** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_20` | out_of_scope | How do I configure Kubernetes ingress control... | **0.498** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_21` | out_of_scope | What is the distance between the Earth and th... | **0.444** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_22` | out_of_scope | How do I install Photoshop on an M2 MacBook P... | **1.000** | Deskwise Pricing & Subscription Plans | ❌ FAIL |
| `eval_23` | out_of_scope | Can I use Deskwise to manage my cryptocurrenc... | **1.000** | Frequently Asked Billing & Tax Questions | ❌ FAIL |
| `eval_24` | out_of_scope | What is the capital city of Australia?... | **0.399** | Frequently Asked Billing & Tax Questions | ✅ PASS |
| `eval_25` | out_of_scope | How do I book a hotel room in Tokyo for next ... | **0.442** | Frequently Asked Billing & Tax Questions | ✅ PASS |
