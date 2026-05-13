---
name: git-commits-helper
description: Guide for writing meaningful commit messages, creating PR descriptions, resolving merge conflicts, and following Git best practices. Covers conventional commits, semantic versioning, and team workflows.
license: MIT
metadata:
  tags: [git, commits, pull-requests, merge-conflicts, version-control, conventions]
  author: "Factory Droid"
---

# Git Commits Helper

## Purpose

This skill guides the agent in creating meaningful Git commits, PR descriptions, and handling Git operations following industry best practices and team conventions.

## When to Use

Use this skill when:
- Writing commit messages
- Creating pull request descriptions
- Resolving merge conflicts
- Rebasing branches
- Following conventional commits
- Writing release notes

## When Not to Use

- For non-Git operations
- When user explicitly wants custom commit message format
- For Git operations that require user confirmation

---

## Core Principles

### 1. Commit Message Anatomy

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 2. Commit Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat(auth): add OAuth login` |
| `fix` | Bug fix | `fix(user): resolve login timeout` |
| `docs` | Documentation | `docs(readme): update installation` |
| `style` | Formatting | `style(lint): fix indentation` |
| `refactor` | Code restructuring | `refactor(api): simplify response` |
| `test` | Tests | `test(auth): add login tests` |
| `chore` | Maintenance | `chore(deps): update dependencies` |
| `perf` | Performance | `perf(query): optimize DB query` |
| `ci` | CI/CD | `ci(github): add test workflow` |

### 3. Subject Line Rules

- Use imperative mood ("add" not "added")
- Maximum 50 characters
- Capitalize first letter
- No period at end
- Think: "If applied, this commit will..."

### 4. Body Rules

- Wrap at 72 characters
- Explain "what" and "why", not "how"
- Include context and motivation
- Reference issues/tickets

### 5. Footer Rules

- Breaking changes: `BREAKING CHANGE: description`
- Issue references: `Closes #123`, `Fixes #456`
- Co-authored-by for pair programming

---

## Conventional Commits

### Full Example

```
feat(auth): implement JWT token refresh mechanism

Previously, tokens expired after 1 hour with no refresh option,
forcing users to re-login frequently.

This commit adds a refresh token flow:
- Issues refresh token alongside access token
- Validates refresh token on expiration
- Stores hashed refresh tokens in database
- Implements token rotation for security

Closes #123
Co-authored-by: Jane Doe <jane@example.com>
```

### Scope Options

- `feat(auth)`: Authentication features
- `feat(ui)`: User interface changes
- `feat(api)`: API endpoints
- `fix(db)`: Database fixes
- `fix(core)`: Core logic fixes

### Breaking Changes

```
feat(api): change response format

BREAKING CHANGE: Response format for /api/users now returns
object with 'data' key instead of raw array.

Before: [{ "id": 1, "name": "John" }]
After: { "data": [{ "id": 1, "name": "John" }] }

Migration: Update client code to access .data property
```

---

## Pull Request Description Template

```markdown
## Summary

Brief description of what this PR does.

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor
- [ ] Documentation
- [ ] CI/CD
- [ ] Other: _____

## Motivation

Why is this change needed?
What problem does it solve?

## Changes

List of files changed:
- `file1.js` - Description
- `file2.py` - Description

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Checklist

- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings

## Screenshots (if applicable)

Before | After
-------|------
Image | Image

## Related Issues

Closes #123
Related to #456

## Notes

Any additional notes for reviewers.
```

---

## Merge Conflict Resolution

### Step 1: Identify Conflicts

```bash
git status                    # Check for unmerged files
git diff --name-only --diff-filter=U  # List conflicted files
```

### Step 2: Understand the Conflict

```
<<<<<<< HEAD (current change)
const config = { debug: true };
=======
const config = {
  debug: false,
  verbose: true
};
>>>>>>> feature/new-config
```

### Resolution Strategies

#### Strategy 1: Accept Current Change
```bash
git checkout --ours path/to/file.js
```

#### Strategy 2: Accept Incoming Change
```bash
git checkout --theirs path/to/file.js
```

#### Strategy 3: Accept Both
```javascript
const config = {
  debug: true,
  verbose: true
};
```

#### Strategy 4: Manual Resolution
1. Open file in editor
2. Remove conflict markers
3. Keep desired code
4. Test changes

### Step 3: Complete Merge

```bash
# After resolving all conflicts
git add path/to/file.js
git commit -m "merge: resolve conflicts from feature-branch"
```

---

## Git Workflow Best Practices

### Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/short-description` | `feature/user-auth` |
| Bugfix | `bugfix/issue-id-description` | `bugfix/123-login-fix` |
| Hotfix | `hotfix/issue-description` | `hotfix/prod-outage` |
| Release | `release/v1.0.0` | `release/v1.0.0` |
| Chore | `chore/description` | `chore/update-deps` |

### Branch Strategy

```
main (production)
  │
  ├── develop (integration)
  │     │
  │     ├── feature/user-auth
  │     ├── feature/payment-api
  │     │
  ├── bugfix/123-login-fix
  │
  └── release/v1.0.0
```

### Commit Frequency

- **Small commits**: Each logical change = one commit
- **Descriptive messages**: Clear, meaningful descriptions
- **Regular pushes**: Push at least daily
- **Pull often**: Stay current with main branch

---

## Commit Message Templates

### For Your Team

Create `.gitmessage.txt`:

```
# Type: feat, fix, docs, style, refactor, test, chore
# <type>(<scope>): <subject>

# Why this change?
# What was the problem?
# How does it solve it?

# Remember to:
# - Use imperative mood
# - Keep subject < 50 chars
# - Wrap body at 72 chars
# - Reference issues
```

Set as default:
```bash
git config commit.template .gitmessage.txt
```

### Examples by Type

**Feature:**
```
feat(api): add user profile endpoint

- GET /api/users/:id returns user details
- Includes avatar, bio, and join date
- Requires authentication

Closes #45
```

**Bug Fix:**
```
fix(auth): resolve session timeout issue

Session was expiring prematurely due to
incorrect timezone handling in JWT validation.

Before: Token expired 1 hour early
After: Token expires at correct time

Fixes #123
```

**Refactor:**
```
refactor(database): simplify user repository

Extract common query logic into base repository
class to reduce duplication.

No behavioral changes.
Tests remain green.
```

**Documentation:**
```
docs(api): update authentication section

- Add OAuth 2.0 flow diagram
- Clarify token refresh procedure
- Fix example cURL commands

Related to #67
```

---

## Git Commands Reference

### Daily Workflow

```bash
# Start work
git checkout main
git pull origin main
git checkout -b feature/my-feature

# Make changes
git add .
git commit -m "feat: add new feature"

# Push
git push origin feature/my-feature

# Update from main
git fetch origin
git rebase origin/main
```

### Undo Operations

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Undo file changes
git checkout -- path/to/file.js

# Amend last commit
git commit --amend -m "new message"

# Unstage files
git reset HEAD path/to/file.js
```

### Inspect History

```bash
# View commit history
git log --oneline -10

# View changes in commit
git show SHA

# View file history
git log --follow -p path/to/file.js

# Search commit messages
git log --grep="keyword"

# View blame
git blame path/to/file.js
```

---

## Research for Best Practices

When investigating Git workflows or team conventions, use mgrep with web search:

```bash
# Example: GitFlow vs trunk-based development
mgrep --web --answer "GitFlow vs trunk-based development 2024"

# Example: Conventional commits best practices
mgrep --web --answer "conventional commits specification best practices"

# Example: PR description templates
mgrep --web --answer "pull request description template best practices"
```

---

## Examples

### Example 1: Feature Commit
**User:** "Commit my new payment feature"

```
feat(payment): integrate Stripe payment gateway

- Add Stripe SDK initialization
- Create payment intent on checkout
- Handle webhook for payment confirmation
- Store transaction records

Closes #89
```

### Example 2: Bug Fix Commit
**User:** "Fix the login timeout bug"

```
fix(auth): resolve session timeout before expiration

JWT tokens were expiring 5 minutes early due to
clock skew between server and token validation.

- Add 5-minute grace period for token validation
- Sync server time with NTP

Fixes #156
```

### Example 3: PR Description
**User:** "Create PR for the payment integration"

Generated PR with:
- Summary of changes
- Type classification
- Testing information
- Checklist
- Screenshots
- Related issues

### Example 4: Merge Conflict Resolution
**User:** "Help me resolve the merge conflict"

```
The conflict is in `src/config.js`:
- HEAD has: `debug: true`
- feature-branch has: `debug: false, verbose: true`

I'll resolve by keeping the verbose flag:
const config = { debug: true, verbose: true };
```

After user approval:
```bash
git add src/config.js
git commit -m "merge: resolve config conflict from feature-branch"
```
