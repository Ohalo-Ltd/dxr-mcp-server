# Data X-Ray MCP Server - Marketplace Submission

This document contains information for submitting the Data X-Ray MCP server to the Claude Marketplace.

## Marketplace Listing

### Title
Data X-Ray - Enterprise Data Discovery & Classification

### Short Description (160 chars)
Search, retrieve, and analyze enterprise documents with automatic sensitivity classification and redaction. Find PII, PHI, and sensitive data safely.

### Full Description

Data X-Ray is an enterprise data discovery and classification platform that indexes documents across your organization and automatically identifies sensitive information like PII, PHI, financial data, credentials, and more.

This MCP server enables Claude to:

**Intelligent Search**
- Find documents using KQL (Kibana Query Language) queries
- Filter by filename, size, type, classifications, or custom metadata
- Search across all indexed datasources
- Paginated results with context-efficient summaries to handle large datasets
- Aggregate statistics showing file counts, types, sizes, and sensitivity metrics

**Sensitivity-Aware Retrieval**
- Understand what classifications each document contains
- Access classification catalog to see all detected sensitive data types
- View lightweight file summaries with sensitivity flags for quick assessment
- Retrieve full document metadata on demand for detailed inspection

**Safe Document Access**
- Retrieve original documents when needed
- Get automatically redacted versions that mask sensitive information
- Choose from multiple redactors based on your security requirements

**Enterprise Use Cases**
- Compliance audits: Find all documents containing specific types of PII
- Data discovery: Understand what sensitive data exists in your organization
- Safe document review: View redacted versions to protect sensitive information
- Information governance: Track document metadata and classifications
- Risk assessment: Identify high-risk documents based on sensitivity

**Typical Workflows**

1. **Finding Sensitive Documents**
   - "Show me all documents containing credit card numbers"
   - Claude queries classifications and returns matching files

2. **Safe Document Review**
   - "Let me read this document but redact any PII"
   - Claude retrieves redacted text with [REDACTED] placeholders

3. **Data Discovery**
   - "What types of sensitive information does our organization have?"
   - Claude lists all available classifications and their descriptions

4. **Compliance Queries**
   - "Find all PDFs over 5MB that contain health information"
   - Claude uses KQL to filter by size, type, and classification

### Category
Enterprise Data & Knowledge Management

### Tags
- enterprise-search
- data-classification
- document-management
- compliance
- data-governance
- security
- redaction
- pii
- phi
- sensitive-data

### Screenshots/Demo

Include screenshots showing:
1. Classification catalog retrieval
2. File search with KQL queries
3. Redacted document viewing
4. Sensitivity-aware responses

## Installation Requirements

**Prerequisites:**
- Node.js 18.0.0 or higher
- Active Data X-Ray instance
- DXR API credentials (Bearer token)

**Configuration:**
Users must provide:
- `DXR_API_URL`: URL of their DXR instance
- `DXR_API_TOKEN`: API authentication token

## Security & Privacy

**Data Handling:**
- All API calls use Bearer token authentication
- No data is stored by the MCP server
- All communication is direct between Claude and the user's DXR instance
- Redaction happens server-side in DXR before content reaches Claude

**Credentials:**
- API tokens should have minimal required permissions
- Tokens should be rotated regularly per organizational security policy
- Never commit tokens to version control

## Support & Documentation

**Documentation:**
- README: Comprehensive setup and usage guide
- API Endpoint Mapping: Clear correspondence between MCP tools and DXR API
- Example queries and workflows

**Support:**
- Email: support@ohalo.co
- Documentation: Link to DXR API documentation
- GitHub Issues: For MCP server specific issues

## Value Proposition for Claude Marketplace

**Why This Integration Matters:**

1. **Enterprise Data Access**: Brings enterprise document repositories into Claude's context
2. **Sensitivity Awareness**: Claude can understand and respect data sensitivity classifications
3. **Safe AI Adoption**: Redaction capabilities enable safe use of AI with sensitive documents
4. **Compliance Support**: Helps organizations meet compliance requirements while using AI
5. **Knowledge Discovery**: Makes enterprise knowledge searchable and accessible to Claude

**Target Audience:**
- Enterprise organizations with Data X-Ray deployments
- Compliance and legal teams
- Information governance professionals
- Security-conscious organizations adopting AI
- Healthcare, financial services, and regulated industries

**Differentiation:**
- Purpose-built for sensitive enterprise data
- Automatic classification and redaction
- Battle-tested in regulated industries
- Deep integration with enterprise data governance workflows

## Technical Details

**Architecture:**
- Built with TypeScript
- Uses official @modelcontextprotocol/sdk
- Follows MCP best practices
- Comprehensive error handling
- Proper authentication flow

**Reliability:**
- Type-safe implementation
- Clear error messages
- Graceful failure handling
- Logging to stderr for debugging

**Performance:**
- Context-efficient pagination with configurable page sizes (default 50, max 500 files)
- Lightweight file summaries reduce context window usage by ~90% vs full metadata
- Aggregate statistics computed once across full result set
- Full metadata retrieved on-demand only for files of interest
- Efficient binary file handling with base64 encoding
- Query-based filtering reduces data transfer at API level

## Future Enhancements

Potential future features:
- Advanced KQL query builder with validation hints
- Batch file operations for bulk processing
- Custom classification creation and management
- Redaction rule customization
- Integration with DXR workflows and automation
- Real-time classification updates via webhooks
- Document upload and indexing capability
- Enhanced filtering options for metadata fields

## Pricing Model

**Current:** Free (requires existing DXR license)
**Future:** Consider tiered pricing based on:
- Number of API calls
- Volume of data accessed
- Number of concurrent users
- Enterprise support level
