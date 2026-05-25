#!/bin/bash
# ============================================================
# LEVRAM STUDIOS — GitHub Setup Script
# Run this once to initialize your repo and push everything
# ============================================================

echo "=== LEVRAM STUDIOS — GitHub Init ==="

# ------------------------------------------------------------
# STEP 1: Navigate to your project folder
# Change this path to wherever you want the project to live
# ------------------------------------------------------------
cd ~/Desktop
mkdir -p LEVRAM_STUDIOS
cd LEVRAM_STUDIOS

# ------------------------------------------------------------
# STEP 2: Initialize Git
# ------------------------------------------------------------
git init
git branch -M main

# ------------------------------------------------------------
# STEP 3: Create .gitignore
# Keeps generated assets out of git (they're too large)
# ------------------------------------------------------------
cat > .gitignore << 'EOF'
# Generated Assets - store locally or in cloud storage
01_PROJECTS/*/ASSETS/Generated_Images/
01_PROJECTS/*/ASSETS/Generated_Video/
01_PROJECTS/*/ASSETS/Exports/

# OS files
.DS_Store
Thumbs.db

# Large media files
*.mp4
*.mov
*.wav
*.mp3
*.png
*.jpg
*.jpeg
*.webp

# Keep prompt files and scripts in git
!**/*_Prompts.md
!**/*_Script*.md
EOF

# ------------------------------------------------------------
# STEP 4: Create README
# ------------------------------------------------------------
cat > README.md << 'EOF'
# LEVRAM STUDIOS

> *"Every hero is the villain in someone else's story."*

A cinematic dark-superhero multiverse brand built on philosophical tragedy, 
psychological consequence, and mythological scale.

## Projects

| Project | Status |
|---|---|
| The Runner | Active |
| The Other Side | Development |
| Levram Banner | Development |

## Structure

```
LEVRAM_STUDIOS/
├── 00_BIBLE/          # Studio identity, philosophy, visual rules, writing rules
├── 01_PROJECTS/       # One folder per story — scripts, prompts, episode concepts
├── 02_BRAND/          # Logo prompts, channel art, style guide
├── 03_TEMPLATES/      # Blank templates for new characters, scenes, episodes
└── 04_PIPELINE/       # Production workflow, AI tools reference, publishing checklist
```

## How to Use

1. Read `00_BIBLE/LEVRAM_Master_System_Prompt.md` — this is the studio identity
2. Paste it into your Claude Project Instructions
3. Upload character bibles and pitch documents to Claude Project Files
4. Follow the pipeline in `04_PIPELINE/LEVRAM_Production_Workflow.md`
5. Use AI prompts from `01_PROJECTS/[PROJECT]/AI_PROMPTS/`

## Tools Used

- Claude (writing, scripts, prompts)
- Midjourney / DALL-E / Stable Diffusion (image generation)
- Runway / Sora / Kling (video generation)
- ElevenLabs (voiceover)
- Suno / Udio (soundtrack)
- GitHub (project files, version control)
EOF

# ------------------------------------------------------------
# STEP 5: Add all files and make first commit
# ------------------------------------------------------------
git add .
git commit -m "Initial commit — LEVRAM Studios project structure and bible"

# ------------------------------------------------------------
# STEP 6: Connect to GitHub
# Replace YOUR_USERNAME and YOUR_REPO_NAME before running
# ------------------------------------------------------------
echo ""
echo "=== NEXT STEPS ==="
echo "1. Go to github.com and create a new repo called: LEVRAM_STUDIOS"
echo "2. Make it PRIVATE (to protect your original content)"
echo "3. Then run these two lines:"
echo ""
echo "   git remote add origin https://github.com/YOUR_USERNAME/LEVRAM_STUDIOS.git"
echo "   git push -u origin main"
echo ""
echo "=== AFTER THAT — Daily workflow ==="
echo "Every time you add or update files:"
echo ""
echo "   git add ."
echo '   git commit -m "Describe what you added"'
echo "   git push origin main"
echo ""
echo "=== PULL FILES INTO CLAUDE PROJECT ==="
echo "1. Open your Claude Project (LEVRAM)"
echo "2. Click + next to Instructions"
echo "3. Paste contents of: 00_BIBLE/LEVRAM_Master_System_Prompt.md"
echo "4. Click + next to Files and upload:"
echo "   - 00_BIBLE/LEVRAM_Core_Philosophy.md"
echo "   - 00_BIBLE/LEVRAM_Visual_Identity.md"
echo "   - 00_BIBLE/LEVRAM_Writing_Rules.md"
echo "   - 01_PROJECTS/THE_RUNNER/_OVERVIEW/TheRunner_Pitch_Document.md"
echo "   - 01_PROJECTS/THE_RUNNER/_OVERVIEW/TheRunner_Character_Bibles/WALLY_Character_Bible.md"
echo "   - 01_PROJECTS/THE_RUNNER/_OVERVIEW/TheRunner_Character_Bibles/BARRY_Character_Bible.md"
echo ""
echo "=== DONE. LEVRAM STUDIOS is live. ==="
