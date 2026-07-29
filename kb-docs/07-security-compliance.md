# Security, Data Privacy & Compliance Standards

## Payment Security (PCI DSS)
Deskwise does not store or process raw credit card numbers or banking credentials on our servers.
- All transactions are securely handled by **Stripe Inc.**, a certified **PCI DSS Level 1** Service Provider.
- Transmission of payment data uses TLS 1.3 encryption with 256-bit AES encryption at rest.

## Data Privacy & GDPR Compliance

### Is Deskwise GDPR Compliant?
Yes. We comply with GDPR (EU Data Protection Regulation) and CCPA (California Consumer Privacy Act).

### Data Erasure & Export Requests
- **Right to Export**: Admin users can export all knowledge base data and conversation logs in JSON/CSV format via **Settings > Security & Export**.
- **Right to be Forgotten**: Upon account termination, customer database records in Neon and vector embeddings in Qdrant are scrubbed within 3 calendar days of request.

## Compliance Certifications
Deskwise Enterprise undergoes annual third-party audits:
- **SOC 2 Type II Certified**: Validating security, availability, and confidentiality controls.
- **ISO/IEC 27001**: Certified infrastructure security management system.
