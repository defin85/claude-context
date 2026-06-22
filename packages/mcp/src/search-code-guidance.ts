export const SEARCH_CODE_TOOL_DESCRIPTION = `
Search the indexed codebase using natural language queries within a specified absolute path.

⚠️ **IMPORTANT**:
- You MUST provide a canonical absolute path.
- Prefer POSIX form (for example, /home/egor/code/repo). WSL UNC paths are normalized automatically, but POSIX form is recommended.

🎯 **When to Use**:
This tool is versatile and can be used before completing various tasks to retrieve relevant context:
- **Code search**: Find specific functions, classes, or implementations
- **Context-aware assistance**: Gather relevant code context before making changes
- **Issue identification**: Locate problematic code sections or bugs
- **Code review**: Understand existing implementations and patterns
- **Refactoring**: Find all related code pieces that need to be updated
- **Feature development**: Understand existing architecture and similar implementations
- **Duplicate detection**: Identify redundant or duplicated code patterns across the codebase

✨ **Usage Guidance**:
- If the codebase is not indexed, this tool will return a clear error message indicating that indexing is required first.
- You can then use the index_codebase tool to index the codebase before searching again.
- For non-trivial 1C exported-configuration tasks, build a context bundle instead of relying on one broad result: search the original user task first, then focused roles for library API, client usage, server usage, applied usage, and metadata/state.
- If 1C metadata/state context is missing, check index scope/profile coverage or filesystem context; this guidance does not change rankingProfile behavior, retrieval scoring, provider behavior, request schema, or response schema.
`;
