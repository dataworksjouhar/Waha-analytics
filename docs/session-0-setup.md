# Session 0: Environment Setup

Goal: an empty but fully working project. By the end you can run Python inside the repo, connect to a cloud Postgres database, and launch Claude Code with the project context already loaded.

Time: about an hour. Nothing conceptual here, just plumbing. Instructions are Windows-first with Mac notes, since you are a Power BI user and almost certainly on Windows.

---

## Step 1: Install the four tools

Install each, then close and reopen your terminal so the commands are recognised.

**1a. Git** (version control, and how your portfolio history gets recorded)
Download from https://git-scm.com/downloads. Accept all defaults during install.
Mac: `brew install git`, or it may already be present.

**1b. Python 3.12** (the language the pipeline is written in)
Download from https://www.python.org/downloads/. **On Windows, tick "Add python.exe to PATH" on the first screen.** Skipping this is the single most common setup failure.
Mac: `brew install python@3.12`.

**1c. VS Code** (your editor)
Download from https://code.visualstudio.com/. After install, open it and add two extensions from the Extensions panel: **Python** (Microsoft) and **PostgreSQL** (any well-rated one, for browsing tables).

**1d. Claude Code** (the build tool)
The native installer is recommended and does not need Node.js.

Windows PowerShell:
```powershell
irm https://claude.ai/install.ps1 | iex
```
Mac, Linux, WSL:
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Note: Claude Code requires a paid plan (Pro, Max, Team, Enterprise, or Console), not the free tier.

**Verify all four.** Open a new terminal and run:
```bash
git --version
python --version
claude --version
```
All three should print version numbers. Python must say 3.12 or higher. If anything fails, run `claude doctor` for Claude Code diagnostics, and for Python re-run the installer with the PATH box ticked.

---

## Step 2: Create the GitHub repository

1. Sign in at https://github.com and click **New repository**.
2. Name: `waha-analytics` (or your preference).
3. Visibility: **Public.** This is a portfolio piece; recruiters and clients should be able to see it. Nothing sensitive goes in here (see Step 6 on secrets).
4. Tick **Add a README file**. Leave the rest blank; we add `.gitignore` manually so you understand what it does.
5. Create, then copy the repository URL from the green **Code** button.

---

## Step 3: Clone the repository to your machine

Pick a sensible location, for example `C:\Projects` on Windows or `~/Projects` on Mac.

```bash
cd C:\Projects
git clone https://github.com/YOUR-USERNAME/waha-analytics.git
cd waha-analytics
```

You now have a local folder linked to GitHub. `git clone` copies the repo down; from here `git push` sends your changes up.

---

## Step 4: Create the folder skeleton

Empty folders are invisible to Git, so each gets a placeholder file. Run from inside the repo:

Windows PowerShell:
```powershell
mkdir config, config\schema, data, data\bronze, data\seeds, generator, pipeline, pipeline\extract, pipeline\transform, pipeline\load, pipeline\dq, sql, app, tests, docs
New-Item -ItemType File config\.gitkeep, generator\.gitkeep, pipeline\.gitkeep, sql\.gitkeep, app\.gitkeep, tests\.gitkeep, data\seeds\.gitkeep
```

Mac or Linux:
```bash
mkdir -p config/schema data/bronze data/seeds generator pipeline/{extract,transform,load,dq} sql app tests docs
touch config/.gitkeep generator/.gitkeep pipeline/.gitkeep sql/.gitkeep app/.gitkeep tests/.gitkeep data/seeds/.gitkeep
```

---

## Step 5: Set up the Python virtual environment

A virtual environment keeps this project's packages separate from everything else on your machine, so upgrading a library here never breaks another project.

```bash
python -m venv .venv
```

Activate it. Windows PowerShell:
```powershell
.venv\Scripts\Activate.ps1
```
(If Windows blocks the script, run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then retry.)

Mac or Linux:
```bash
source .venv/bin/activate
```

Your prompt should now show `(.venv)`. **You must activate it at the start of every working session.**

Create `requirements.txt` in the repo root with:
```
pandas
numpy
sqlalchemy
psycopg2-binary
python-dotenv
pyyaml
pytest
```

Install:
```bash
pip install -r requirements.txt
```

What these are: pandas and numpy for data manipulation, SQLAlchemy plus psycopg2 to talk to Postgres, python-dotenv to read secrets from a file, pyyaml to read the client config, pytest for tests.

---

## Step 6: Create the Postgres database

Use **Supabase**. It is free for this scale, it is real Postgres, and it also provides the authentication we will need in Phase 2, which saves a migration later. Neon is an equally good pure-Postgres alternative if you prefer.

1. Sign up at https://supabase.com and create a new project.
2. Choose a region close to Kuwait (Frankfurt or Mumbai are the usual best options).
3. Set a strong database password and save it in your password manager immediately. It is shown once.
4. Wait about two minutes for provisioning.
5. Go to **Project Settings**, then **Database**, and copy the **connection string** (URI format). It looks like `postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres`.

---

## Step 7: Store the connection string safely

This is the security habit that matters most, so understand it rather than just copying.

Create a file named `.env` in the repo root:
```
DATABASE_URL=postgresql://postgres:YOUR-PASSWORD@db.xxxx.supabase.co:5432/postgres
```

Create a file named `.gitignore` in the repo root:
```
.env
.venv/
data/bronze/
__pycache__/
*.pyc
.DS_Store
```

`.gitignore` tells Git to never track those files. **Your `.env` holds a live database password, and your repo is public, so it must never be committed.** Generated bronze data is excluded too, since it can always be regenerated and would bloat the repo.

Now test the connection. Create `test_connection.py` in the repo root:

```python
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
engine = create_engine(os.environ["DATABASE_URL"])

with engine.connect() as conn:
    version = conn.execute(text("SELECT version()")).scalar()
    print("Connected:", version)
```

Run it:
```bash
python test_connection.py
```

You should see a PostgreSQL version string. If it fails, the usual causes are a wrong password, a `.env` saved in the wrong folder, or the project still provisioning. Delete this file once it works; it has done its job.

---

## Step 8: Add the project documentation

1. Save `CLAUDE.md` to the repo **root**.
2. Save `phase0-architecture.md` into the **`docs/`** folder.

The first line of `CLAUDE.md` imports the architecture doc, so Claude Code will read both automatically at the start of every session.

---

## Step 9: First commit and push

```bash
git add .
git status
```

**Read the `git status` output before committing.** Confirm that `.env` and `.venv/` are NOT listed. If they appear, your `.gitignore` is in the wrong place or misspelled. Fix it before continuing.

```bash
git commit -m "Session 0: project scaffolding, environment and database setup"
git push
```

Refresh your GitHub page. You should see the folder structure, `CLAUDE.md`, and `docs/phase0-architecture.md`, and no `.env`.

---

## Step 10: Launch Claude Code and confirm context

From inside the repo folder:
```bash
claude
```

Log in through the browser prompt on first run. Then ask it:

> Read CLAUDE.md and the architecture doc, then summarise this project back to me in five bullets, including the four own-operated venues and the definition of done for Phase 1.

If the summary is accurate, your context is wired correctly and Session 0 is complete. If it is vague, check that `CLAUDE.md` is at the root and that `docs/phase0-architecture.md` exists.

---

## Completion checklist

- [ ] `git --version`, `python --version`, `claude --version` all print versions
- [ ] Repo cloned locally and linked to GitHub
- [ ] Folder skeleton created
- [ ] `.venv` activates and packages installed
- [ ] `test_connection.py` printed a PostgreSQL version, then was deleted
- [ ] `.env` exists locally and is NOT on GitHub
- [ ] `CLAUDE.md` at root, `phase0-architecture.md` in `docs/`
- [ ] First commit pushed
- [ ] Claude Code summarised the project correctly

Then open Claude Code in the repo and say: **"start Phase 1, session 1."**
