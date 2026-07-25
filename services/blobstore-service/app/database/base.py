"""
app/database/base.py

SQLAlchemy declarative base shared across all ORM models.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Common declarative base for all SQLAlchemy models."""
    pass
