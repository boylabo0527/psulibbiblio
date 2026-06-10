"""TF-IDF based course<->title matching with cosine similarity and explainability."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

DEFAULT_TOP_K = 10
DEFAULT_MIN_SCORE = 0.05


@dataclass
class TitleDoc:
    id: int
    text: str


@dataclass
class CourseDoc:
    id: int
    text: str


def _title_text(t: dict) -> str:
    parts = [
        t.get("title", ""),
        t.get("author", ""),
        t.get("publisher", ""),
        t.get("raw_subjects", "") or t.get("subjects", ""),
    ]
    return " ".join(p for p in parts if p)


def _course_text(c: dict) -> str:
    parts = [
        c.get("course_title", ""),
        c.get("major", ""),
        c.get("program", ""),
        c.get("college", ""),
        c.get("description", ""),
        c.get("learning_outcomes", ""),
        c.get("keywords", ""),
    ]
    return " ".join(p for p in parts if p)


def match(
    courses: list[dict],
    titles: list[dict],
    top_k: int = DEFAULT_TOP_K,
    min_score: float = DEFAULT_MIN_SCORE,
) -> list[dict]:
    """Return list of {course_id, title_id, score, rank, explanation}."""
    if not courses or not titles:
        return []

    title_texts = [_title_text(t) for t in titles]
    course_texts = [_course_text(c) for c in courses]

    vec = TfidfVectorizer(
        lowercase=True,
        stop_words="english",
        ngram_range=(1, 2),
        max_df=0.95,
        min_df=1,
        sublinear_tf=True,
    )
    # Fit on combined corpus so vocabulary spans both sides.
    vec.fit(title_texts + course_texts)
    title_mat = vec.transform(title_texts)
    course_mat = vec.transform(course_texts)
    feature_names = np.array(vec.get_feature_names_out())

    sims = cosine_similarity(course_mat, title_mat)

    results: list[dict] = []
    for i, c in enumerate(courses):
        order = np.argsort(-sims[i])
        rank = 0
        for j in order[:top_k]:
            score = float(sims[i, j])
            if score < min_score:
                break
            rank += 1
            # Explainability: top overlapping terms by product of TF-IDF weights.
            c_vec = course_mat[i].toarray().ravel()
            t_vec = title_mat[j].toarray().ravel()
            contrib = c_vec * t_vec
            top_idx = np.argsort(-contrib)[:5]
            top_terms = [feature_names[k] for k in top_idx if contrib[k] > 0]
            explanation = (
                f"cosine={score:.3f}; shared terms: {', '.join(top_terms) if top_terms else 'n/a'}"
            )
            results.append({
                "course_id": c.get("id"),
                "title_id": titles[j].get("id"),
                "score": score,
                "rank": rank,
                "explanation": explanation,
            })
    return results


def recommend_copies(course_matches_per_title: int, total_enrollment: int) -> int:
    """Simple heuristic for copy count."""
    base = max(1, course_matches_per_title)
    enrollment_factor = max(0, total_enrollment // 40)  # 1 copy per ~40 students
    return min(20, base + enrollment_factor)
