import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database.base import Base


class DocumentStatus:
    UPLOADED   = "UPLOADED"    # raw file in blobstore, extraction not started
    EXTRACTING = "EXTRACTING"  # extractor job in progress
    EXTRACTED  = "EXTRACTED"   # extracted JSON blob stored
    VERIFIED   = "VERIFIED"    # downstream service confirmed content
    FAILED     = "FAILED"      # extraction failed after max retries


class DocumentType:
    AADHAAR       = "aadhaar"
    PAN           = "pan"
    PASSPORT      = "passport"
    PAYSLIP       = "payslip"
    ATTENDANCE    = "attendance"
    PF_ECR        = "pf_ecr"
    PF_CHALLAN    = "pf_challan"
    ESI_CHALLAN   = "esi_challan"
    PT_CHALLAN    = "pt_challan"
    FORM_16       = "form_16"
    SALARY_STRUCT = "salary_structure"


class DocumentRegistry(Base):
    __tablename__ = "document_registry"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id            = Column(UUID(as_uuid=True), nullable=False, index=True)

    # Both point to rows in the blobs table
    raw_blob_id          = Column(UUID(as_uuid=True), ForeignKey("blobs.id"), nullable=False)
    extracted_blob_id    = Column(UUID(as_uuid=True), ForeignKey("blobs.id"), nullable=True)

    doc_type             = Column(String(50), nullable=False, index=True)
    status               = Column(String(20), nullable=False, default=DocumentStatus.UPLOADED)

    # Domain context — nullable because not all docs belong to one employee/cycle
    employee_id          = Column(UUID(as_uuid=True), nullable=True, index=True)
    payroll_cycle_id     = Column(UUID(as_uuid=True), nullable=True, index=True)
    month                = Column(String(10), nullable=True)  # "Jan26"

    # Extraction metadata
    extraction_confidence = Column(String(10), nullable=True)  # LOW/MEDIUM/HIGH
    extraction_error      = Column(Text, nullable=True)
    extraction_attempts   = Column(Integer, nullable=False, default=0)

    created_at           = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at           = Column(DateTime(timezone=True), default=datetime.utcnow,
                                  onupdate=datetime.utcnow, nullable=False)
