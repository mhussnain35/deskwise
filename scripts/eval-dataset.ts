export interface TestCase {
  id: string;
  category: "in_scope" | "out_of_scope";
  query: string;
  expectedDocTitle?: string;
  expectedSectionKeyword?: string;
  shouldTriggerFallback: boolean;
}

export const EVAL_DATASET: TestCase[] = [
  // --- In-Scope SaaS Billing & Support Queries (15 Test Cases) ---
  {
    id: "eval_01",
    category: "in_scope",
    query: "How much does the Pro subscription plan cost and how many seats are included?",
    expectedDocTitle: "01-pricing-plans.md",
    expectedSectionKeyword: "Pro Tier",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_02",
    category: "in_scope",
    query: "What is your refund policy within the first 14 days of purchase?",
    expectedDocTitle: "02-refund-policy.md",
    expectedSectionKeyword: "14-Day Money-Back Guarantee",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_03",
    category: "in_scope",
    query: "How do I cancel my subscription in the admin console?",
    expectedDocTitle: "03-cancellation-flow.md",
    expectedSectionKeyword: "Step-by-Step Self-Serve Cancellation",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_04",
    category: "in_scope",
    query: "What happens to my document data after I cancel my account?",
    expectedDocTitle: "03-cancellation-flow.md",
    expectedSectionKeyword: "30-Day Grace Window",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_05",
    category: "in_scope",
    query: "Why did my payment fail and how many times will you retry charging my card?",
    expectedDocTitle: "04-payment-failures.md",
    expectedSectionKeyword: "Automatic Payment Retry Schedule",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_06",
    category: "in_scope",
    query: "How long is the payment failure grace period before my account gets suspended?",
    expectedDocTitle: "04-payment-failures.md",
    expectedSectionKeyword: "7-Day Grace Period",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_07",
    category: "in_scope",
    query: "How does proration work when I upgrade mid-cycle from Pro to Enterprise?",
    expectedDocTitle: "05-upgrades-downgrades.md",
    expectedSectionKeyword: "Proration Credit Calculation",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_08",
    category: "in_scope",
    query: "When does a plan downgrade take effect after requesting it?",
    expectedDocTitle: "05-upgrades-downgrades.md",
    expectedSectionKeyword: "Effective Date of Downgrade",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_09",
    category: "in_scope",
    query: "Where can I download my PDF billing invoices and VAT receipts?",
    expectedDocTitle: "06-billing-faq.md",
    expectedSectionKeyword: "Invoices & Receipts",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_10",
    category: "in_scope",
    query: "Do you support reverse-charge VAT for European Union businesses?",
    expectedDocTitle: "06-billing-faq.md",
    expectedSectionKeyword: "EU & UK Businesses",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_11",
    category: "in_scope",
    query: "What payment methods are accepted for annual Enterprise plans?",
    expectedDocTitle: "06-billing-faq.md",
    expectedSectionKeyword: "Payment Methods",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_12",
    category: "in_scope",
    query: "Is Deskwise PCI DSS compliant for credit card processing?",
    expectedDocTitle: "07-security-compliance.md",
    expectedSectionKeyword: "Payment Security",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_13",
    category: "in_scope",
    query: "How do I request a full data export or GDPR erasure of my account?",
    expectedDocTitle: "07-security-compliance.md",
    expectedSectionKeyword: "Data Erasure & Export Requests",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_14",
    category: "in_scope",
    query: "Does Deskwise have a SOC 2 Type II compliance certification?",
    expectedDocTitle: "07-security-compliance.md",
    expectedSectionKeyword: "Compliance Certifications",
    shouldTriggerFallback: false,
  },
  {
    id: "eval_15",
    category: "in_scope",
    query: "Can I pause my subscription instead of completely cancelling?",
    expectedDocTitle: "03-cancellation-flow.md",
    expectedSectionKeyword: "Pausing Subscription",
    shouldTriggerFallback: false,
  },

  // --- Out-of-Scope Intentional Fallback Test Queries (10 Test Cases) ---
  {
    id: "eval_16",
    category: "out_of_scope",
    query: "What is the secret recipe for baking a chocolate fudge cake?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_17",
    category: "out_of_scope",
    query: "How do I write a binary search algorithm in Python?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_18",
    category: "out_of_scope",
    query: "Who won the FIFA World Cup in 2022?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_19",
    category: "out_of_scope",
    query: "Can you give me a discount code for buying a Tesla Model 3?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_20",
    category: "out_of_scope",
    query: "How do I configure Kubernetes ingress controllers on AWS?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_21",
    category: "out_of_scope",
    query: "What is the distance between the Earth and the Moon in kilometers?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_22",
    category: "out_of_scope",
    query: "How do I install Photoshop on an M2 MacBook Pro?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_23",
    category: "out_of_scope",
    query: "Can I use Deskwise to manage my cryptocurrency portfolio on Binance?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_24",
    category: "out_of_scope",
    query: "What is the capital city of Australia?",
    shouldTriggerFallback: true,
  },
  {
    id: "eval_25",
    category: "out_of_scope",
    query: "How do I book a hotel room in Tokyo for next weekend?",
    shouldTriggerFallback: true,
  },
];
