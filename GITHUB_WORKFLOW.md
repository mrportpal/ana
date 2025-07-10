# GitHub Workflow Guide for Claude Code

## Core Principles
- **NEVER work directly on main/master branch**
- **Always create feature branches for new work**
- **Test before committing**
- **Use Pull Requests for code review**
- **Make small, frequent commits with clear messages**

## Standard Workflow

### 1. Starting New Work
```bash
# Always start from main and create feature branch
git checkout main
git pull origin main
git checkout -b feature/[descriptive-name]
```

**Branch naming conventions:**
- `feature/audio-improvements`
- `fix/transcription-timeout`
- `experiment/new-api-integration`
- `refactor/pipeline-cleanup`

### 2. Development Cycle
```bash
# Make changes, then:
git add [specific-files]          # Stage specific files
git commit -m "Clear description" # Descriptive commit message
git push origin [branch-name]     # Backup to GitHub regularly
```

### 3. Before Every Commit
- [ ] Run tests/pipeline to ensure code works
- [ ] Check `git status` and `git diff` to review changes
- [ ] Verify no sensitive data (API keys, passwords) in commit
- [ ] Ensure commit message describes the "why" not just "what"

### 4. Creating Pull Requests
```bash
# When feature is complete:
gh pr create --title "Clear title" --body "$(cat <<'EOF'
## Summary
- Brief description of changes
- Why this change was needed

## Testing
- [ ] Pipeline runs successfully
- [ ] No breaking changes
- [ ] Tested with sample data

## Notes
Any additional context or considerations
EOF
)"
```

### 5. Merging and Cleanup
```bash
# After PR is approved and merged:
git checkout main
git pull origin main
git branch -d feature/[branch-name]  # Delete local branch
```

## Claude Code Instructions

### When Recommending Commits:
**Instead of saying:** "Let's commit these changes"

**Say:** "I recommend creating a feature branch and committing these changes. Based on our GitHub workflow:
1. Should I create a feature branch for this work?
2. Have you tested the changes?
3. Shall I create a commit with these specific files?
4. Do you want a PR when this feature is complete?"

### Before Any Git Operations:
1. Check if we're on main branch → suggest feature branch
2. Run tests if available
3. Review what files are being committed
4. Suggest appropriate commit message
5. Ask about PR creation when feature is done

### Commit Message Format:
```
Type: Brief description (50 chars max)

Longer explanation if needed:
- What was changed
- Why it was changed
- Any important notes

Examples:
- "Fix: Handle API timeout errors in audio download"
- "Feature: Add retry logic for failed transcriptions"
- "Refactor: Simplify pipeline state management"
```

## File Management

### Always in .gitignore:
- `node_modules/`
- `.env` files
- Log files (`*.log`)
- Test data files
- Temporary files
- Build artifacts

### Commit Guidelines:
- **DO commit:** Source code, config files, documentation
- **DON'T commit:** Secrets, large files, generated files, test data

## Emergency Procedures

### Accidentally committed to main:
```bash
git reset --soft HEAD~1  # Undo last commit, keep changes
git checkout -b feature/fix-commit
git commit -m "Move changes to feature branch"
```

### Need to undo changes:
```bash
git stash                # Temporarily save changes
git stash pop           # Restore changes
git checkout -- file   # Discard changes to specific file
```

### Fix last commit message:
```bash
git commit --amend -m "Better commit message"
```

## Integration with CLAUDE.md

Add this to your CLAUDE.md file:
```
## GitHub Workflow
Always follow the GitHub workflow guide in GITHUB_WORKFLOW.md:
- Create feature branches for all work
- Test before committing  
- Use descriptive commit messages
- Create PRs for code review
- Ask user about workflow decisions
```

## Quick Reference

| Situation | Command | Notes |
|-----------|---------|-------|
| Start new feature | `git checkout -b feature/name` | Always from main |
| Save work | `git add . && git commit -m "message"` | Test first |
| Backup | `git push origin branch-name` | Push regularly |
| Create PR | `gh pr create --title "title" --body "description"` | When feature done |
| Switch branches | `git checkout branch-name` | Check git status first |
| See changes | `git status && git diff` | Before committing |

---

**Remember:** This workflow prevents broken main branch, enables collaboration, and maintains project history. Always ask the user before making workflow decisions!