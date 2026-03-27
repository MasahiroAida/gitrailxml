# gitrailxml

`gitrailxml` is a Node.js CLI tool that generates an XML bundle of file histories between a base branch and a target branch.

It walks commits from the merge base to the target branch in chronological order, creates the first observed version of each file as the base content, and appends later changes as per-commit history entries.

gitrailxml consolidates repository diffs and per-commit history entries into a single file to make loading into AI tools easier.
It is well suited for checking differences and consistency between development and staging environments before deployment.

Hopefully, this will free us from deployment mishaps...:upside_down:

## Acknowledgements

Inspired by [yamadashy/repomix](https://github.com/yamadashy/repomix).
This project was sparked by ideas from repomix, a fantastic tool that has been extremely useful in practice.
If you have not used it yet, it is well worth trying.

## Features

- Compare a base branch and a target branch
- Walk commits from oldest to newest
- Store the first observed file content as `base_file`
- Append later changes with branch name, commit id, author, date, and diff
- Support renamed files
- Filter by file extensions
- Exclude directories
- Export a single XML file for AI review or manual audit

## Installation

### Global install

```bash
npm install -g gitrailxml
```

### Local development install

Inside the package directory:

```bash
npm install
```

Then run with:

```bash
node ./bin/gitrailxml.js --base-branch main --target-branch feature/login-refactor
```

### Run with npx

If the package is published:

```bash
npx gitrailxml --base-branch main --target-branch feature/login-refactor
```

## Usage

Run the command inside the target Git repository.

### Basic example

```bash
gitrailxml --base-branch main --target-branch feature/login-refactor
```

This writes:

```text
branch_history.xml
```

to the current repository directory.

### Custom output file

```bash
gitrailxml --base-branch main --target-branch feature/login-refactor --output feature_login_refactor_history.xml
```

### Filter by extensions

```bash
gitrailxml --base-branch main --target-branch feature/login-refactor --include-ext .py,.yaml,.yml,.json,.conf,.md
```

### Exclude merge commits

```bash
gitrailxml --base-branch main --target-branch feature/login-refactor --no-merges
```

### Show progress while generating XML

```bash
gitrailxml --base-branch main --target-branch feature/login-refactor --progress
```

### Environment comparison example

```bash
gitrailxml --base-branch origin/develop --target-branch origin/staging --output staging_diff.xml --progress
```

### Custom excluded directories

```bash
gitrailxml --base-branch main --target-branch feature/login-refactor --exclude-dirs .git,node_modules,build,dist,__pycache__
```

## Options

| Option | Description |
|---|---|
| `--base-branch` | Base branch name |
| `--target-branch` | Target branch name |
| `--output` | Output XML file name. Default: `branch_history.xml` |
| `--include-ext` | Comma-separated list of file extensions to include |
| `--exclude-dirs` | Comma-separated list of directories to exclude |
| `--no-merges` | Exclude merge commits |
| `--progress` | Show progress while generating XML |
| `-h`, `--help` | Show help |

## How it works

1. Resolve the merge base between the base branch and the target branch
2. Read commits from `merge-base..target-branch` in chronological order
3. For each changed file:
   - create a `<file>` block the first time the file appears
   - store the previous version of the file as `<base_file>`
   - append each later change as a `<change>` entry
4. Write all data into a single XML document

## Output structure

Example:

```xml
<branch_history base_branch="main" target_branch="feature/login-refactor">
  <summary>
    <commit_count>12</commit_count>
    <file_count>4</file_count>
  </summary>
  <commits>
    <commit id="..." author="..." email="..." date="...">
      <subject>Add company column</subject>
    </commit>
  </commits>
  <files>
    <file path="backend/app/models.py">
      <base_file><![CDATA[...]]></base_file>
      <history>
        <change branch="work_iida" commit_id="..." author="..." date="..." status="M">
          <subject>Add company column</subject>
          <diff><![CDATA[diff --git a/app/models.py b/app/models.py
index 662c6ff..f739f52 100644
--- a/app/models.py
+++ b/app/models.py
@@ -79,6 +79,7 @@ class AuthorityLevel(Base):
     __tablename__ = "authority_levels"

     id = Column(String, primary_key=True, index=True)
+    company_id = Column(String, ForeignKey("companies.id"), nullable=True, index=True)
     name = Column(String, nullable=False)
     level = Column(Integer, nullable=False)
     description = Column(Text, nullable=True)
]]></diff>
        </change>
      </history>
    </file>
  </files>
</branch_history>
```

## Notes and cautions

- Run the tool inside a Git repository.
- The tool does **not** run `git fetch`.
- Branch names are used exactly as provided.
- If you want to compare remote-tracking branches, use names such as:
  - `origin/main`
  - `origin/feature/login-refactor`
- The tool reads Git history only. It does not validate application logic, migrations, or deployment safety by itself.
- Large repositories or large diffs can generate very large XML files.
- Binary files are not suitable for this format.
- If a file is renamed, the tool keeps tracking it and adds the `renamed_from` attribute.
- The first observed file content is taken from the parent state of the commit where the file first appears in the traversal.
- For newly added files, `base_file` is empty.
- If your local branch is outdated, the result reflects local refs, not the latest remote refs.

## Recommended workflow

If you want to compare the latest remote state:

```bash
git fetch --all --prune
gitrailxml --base-branch origin/develop --target-branch origin/staging --output staging_diff.xml
```

## Troubleshooting

### Not a Git repository

Reason:
- The command was run outside a Git repository.

Fix:
- Move to the repository root and run again.

### Merge base resolution failed

Reason:
- The provided branch names do not exist locally.
- The branch names are incorrect.
- The refs are not available in the local repository.

Fix:
- Check available refs:

```bash
git branch --all
```

- If needed, fetch remote refs first:

```bash
git fetch --all --prune
```

### Command not found

Reason:
- The package is not installed globally.
- The current shell does not have npm global bin in `PATH`.

Fix:
- Run with `npx` or use the local file directly:

```bash
npx gitrailxml --base-branch main --target-branch feature/login-refactor
```

or

```bash
node ./bin/gitrailxml.js --base-branch main --target-branch feature/login-refactor
```

## License

MIT
