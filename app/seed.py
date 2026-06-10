"""Seed PSU campus/college/program data from data/psu_programs.csv."""
from pathlib import Path
import pandas as pd

from .db import SessionLocal, init_db
from . import models

CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "psu_programs.csv"


def seed_programs() -> int:
    """Insert PSU programs as Course rows (one per Program+Major)."""
    init_db()
    if not CSV_PATH.exists():
        return 0
    df = pd.read_csv(CSV_PATH).fillna("")
    df.columns = [c.strip() for c in df.columns]

    inserted = 0
    with SessionLocal() as db:
        existing = {
            (c.campus, c.college, c.program, c.major)
            for c in db.query(models.Course).all()
        }
        for _, row in df.iterrows():
            campus = str(row.get("Campus", "")).strip()
            college = str(row.get("College", "")).strip()
            program = str(row.get("Program / Degree", "")).strip()
            major = str(row.get("Major/ Track / Specialization", "")).strip()
            if not program:
                continue
            key = (campus, college, program, major)
            if key in existing:
                continue
            course = models.Course(
                campus=campus,
                college=college,
                program=program,
                major=major,
                course_code="",
                course_title=program + (f" - {major}" if major else ""),
                description=f"{program} program at {college}, {campus}." + (f" Major/track: {major}." if major else ""),
                learning_outcomes="",
                keywords=major,
                enrollment=0,
            )
            db.add(course)
            existing.add(key)
            inserted += 1
        db.commit()
    return inserted


if __name__ == "__main__":
    n = seed_programs()
    print(f"Seeded {n} program rows.")
