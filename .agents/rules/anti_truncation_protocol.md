# ⚠️ ULTRON INITIATIVE: Code Preservation & Anti-Truncation Protocol (CRITICAL)

These rules are strict constraints for the agent (CTO) and must be followed as the highest priority during all code modifications.

## 1. No Lazy Coding
- **NEVER** use placeholder comments such as `// ... rest of the code`, `// existing code remains here`, or similar abbreviations.
- When editing a file, **100% of the previous content** (including imports, types, functions, and logic—especially related to CCXT, Gann, and SMC) that is not meant to change MUST be preserved exactly as it was.
- If using full file write tools, the entire complete file must be output. Always prefer surgical replacements (`replace_file_content` / `multi_replace_file_content`) over full rewrites to minimize risk.

## 2. Zero Implicit Deletion
- **NEVER** delete any function, import, or logic block unless directly and explicitly instructed by the Tech Lead (User) to do so (e.g., "Delete function X").
- If modifying a single line or block, the remaining 99% of the file must remain completely untouched.

## 3. Read-Before-Write
- **ALWAYS** read the source file entirely (using `view_file` or equivalent tools) before attempting any edits.
- Understand the context, apply changes surgically in memory, and then output the precise replacements or full file accurately without any loss of existing code.

---
**Enforcement**: These are Red Lines. Failure to adhere to these rules constitutes a critical violation of the development protocol.
