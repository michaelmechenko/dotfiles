---
description: Write content to markdown file in CWD
---

Write the provided content to a markdown file in the current working directory.

<context>
Content to write: $ARGUMENTS
</context>

<workflow>
1. Extract or generate the content
2. If no filename specified, infer from content or ask
3. Ensure filename ends with `.md`
4. Write to current working directory
5. Confirm file created with path
</workflow>

<filename_inference>
- If content is about a specific topic, use topic name
- If user provides title/heading, use that
- Otherwise, use descriptive name from first paragraph
- Convert to kebab-case: "My Document" → "my-document.md"
</filename_inference>

<output>
- Filename used
- Full path to created file
- Brief summary of content written
</output>
