---
name: aws-lookup
description: "Efficient AWS documentation lookup and architecture guidance using the AWS Documentation MCP server. Use this skill whenever the user asks about AWS services, needs to configure AWS resources (in Terraform, CloudFormation, CDK, or console), wants to understand AWS pricing, troubleshoot AWS errors, or asks about IAM policies, S3, EC2, Lambda, ECS, RDS, VPC, CloudWatch, or any other AWS service. Also trigger for questions about AWS best practices, security configurations, or when the user is writing Terraform for AWS resources."
---

# AWS Lookup

Structured AWS documentation research using the AWS Documentation MCP server tools.

## Tools Available

- `mcp__aws-documentation-mcp-server__search_documentation` -- Search across all AWS docs
- `mcp__aws-documentation-mcp-server__read_documentation` -- Read a specific doc page (paginated)
- `mcp__aws-documentation-mcp-server__recommend` -- Find related docs and recent updates

## Research Workflow

### 1. Search

Start with a specific technical search:
```
search_documentation("ECS task definition memory limits")
```

Use precise terms rather than broad phrases:
- Good: "S3 bucket policy cross-account access"
- Bad: "S3 permissions"

### 2. Read

When you find a relevant page, read it. Long pages (>30,000 chars) are paginated -- use `start_index` to continue reading. Stop reading once you've found what you need.

### 3. Recommend

Use `recommend` to:
- Discover related docs you might have missed
- Find recently updated content for a service (check the "New" section)
- Pivot when direct search doesn't yield results

Give `recommend` any URL from the service you're investigating -- it returns related pages.

### 4. Cite

Always include the documentation URL when providing information.

## Common Lookup Patterns

### Terraform + AWS

When the user is writing Terraform for AWS:
1. Search for the AWS service docs to understand the resource
2. Cross-reference with `context7` for Terraform provider docs:
   - `mcp__context7__resolve-library-id` for "hashicorp/terraform-provider-aws"
   - `mcp__context7__query-docs` for specific resource configuration
3. Combine AWS best practices with Terraform resource syntax

### IAM Policy Questions

IAM is the most common and most confusing AWS topic:
- Search for the specific service's "Actions, resources, and condition keys" page
- Check IAM policy examples in the service's security documentation
- For cross-account access, search for "cross-account" + service name
- For least-privilege, search for the specific API actions needed

### Error Troubleshooting

When the user has an AWS error:
1. Search for the exact error message or error code
2. Check the service's troubleshooting guide: search "<service> troubleshooting"
3. Use `recommend` on the troubleshooting page to find related known issues
4. Check CloudWatch metrics and alarm documentation if monitoring-related

### Architecture Decisions

When the user is choosing between AWS services:
1. Search for the comparison page (e.g., "ECS vs EKS", "Aurora vs RDS")
2. Check the Well-Architected Framework docs for the relevant pillar
3. Look for the service's "best practices" page
4. Check pricing pages for cost comparison

## Service Quick Reference

Common doc entry points by service area:

- **Compute**: EC2 (instances, AMIs, security groups), Lambda (functions, layers, concurrency), ECS/EKS (containers)
- **Storage**: S3 (buckets, policies, lifecycle), EBS (volumes, snapshots), EFS (file systems)
- **Database**: RDS (instances, parameter groups), Aurora (clusters, endpoints), DynamoDB (tables, GSIs)
- **Networking**: VPC (subnets, route tables, NAT), ALB/NLB (target groups, listeners), CloudFront (distributions)
- **Security**: IAM (policies, roles, OIDC), KMS (keys, grants), Secrets Manager, Security Hub
- **Monitoring**: CloudWatch (metrics, alarms, logs), X-Ray (traces), CloudTrail (API audit)
- **IaC**: CloudFormation (stacks, templates), CDK (constructs), Service Catalog

## Tips

- If multiple searches with similar terms fail, pivot to `recommend` on a nearby page
- For recent changes to a service, use `recommend` and check the "New" section
- Pagination: `read_documentation` returns chunks -- keep reading with increasing `start_index` until you find what you need
- AWS docs are verbose -- extract just the relevant section rather than summarizing the whole page
