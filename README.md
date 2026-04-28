# ROTR Practice Quiz

Interactive multiple-choice quiz for the **COLREGS / Rules of the Road (ROTR)**.

**Live site:** https://natgu5171.github.io/rotr-quiz/

## Features

- Filter by scope (International, Inland, or both)
- Select specific rules to practice
- Configurable number of questions (5–50)
- Results by rule with a "Rules to review" summary
- Quiz history stored in the browser (localStorage)
- Export questions as CSV for Google Forms

## Running locally

```bash
python3 start_quiz.py
```

Opens the quiz at `http://localhost:8081/`.

## Data sources

Questions are stored in `rotr_questions.json` (generated from `rotr_questions.db` via `extract_questions.py`).
Illustrations are in `images/`.

## Deployment

The site is published via GitHub Pages from the `main` branch root.
Only `index.html`, `rotr_questions.json`, and `images/` are served publicly.
Local tools (`start_quiz.py`, `extract_*.py`, `rotr_questions.db`, etc.) are kept in the repo for reference but are not part of the site.
