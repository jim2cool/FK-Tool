Review what we built or fixed in this session and update project memory.

Steps:
1. Run `git log --oneline -10` to see recent commits
2. Run `git diff HEAD~1 --stat` to see what files changed
3. Read the current `CLAUDE.md` in the project root
4. Update `CLAUDE.md` with anything new or changed:
   - New files or key files modified
   - New DB columns, tables, or constraints discovered
   - Bugs fixed and their root causes (especially gotchas to remember)
   - New features completed
   - Backlog items added or completed
   - Any deployment issues encountered and resolved
5. Commit the updated CLAUDE.md with message: `docs: update CLAUDE.md with session learnings`
6. Also update `~/.claude/projects/C--Users-shash-Documents-FK-Tool/memory/MEMORY.md` with the same key points
7. Confirm what was added to both files
