# Claude Code Instructions for Ana Project

## GitHub Workflow
**ALWAYS follow the GitHub workflow guide in GITHUB_WORKFLOW.md before making any commits or changes:**
- Create feature branches for all work (never work directly on main)
- Test changes before committing
- Use descriptive commit messages
- Create PRs for code review
- Ask user about workflow decisions

## Project Context
This is an audio processing pipeline for mortgage call analysis with stages:
1. Get call IDs
2. Download audio recordings  
3. Transcribe audio
4. Upload audio files
5. Analyze transcripts

## Development Guidelines
- Always run tests/pipeline before committing
- Check for API keys or sensitive data before commits
- Use the existing project structure and conventions
- Follow the .gitignore rules for test files and logs

## Before Any Git Operations
1. Check if we're on main branch → suggest feature branch
2. Run available tests
3. Review what files are being committed
4. Ask about PR creation when features are complete