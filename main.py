import base64
import os
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from pydantic import BaseModel

from r1.checks import validate_rows
from r1.logic_api import router as logic_router
from r1.mapper import map_records
from r1.parser import parse_records
from r1.validate_api import router as validate_router
from r1.xml_table_api import router as xml_table_router

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="EDI Spreadsheet")


# ---------------------------------------------------------------
# Optional login (internet par deploy karte waqt zaroori).
# APP_PASSWORD set ho to har page / API par username + password maanga
# jata hai. Set na ho (apne PC par chalate waqt) to login nahi lagta.
#   APP_USERNAME  (default: admin)
#   APP_PASSWORD  (khali = login band)
# ---------------------------------------------------------------
APP_USERNAME = os.environ.get("APP_USERNAME", "admin")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")


class BasicAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if not APP_PASSWORD:
            return await call_next(request)

        header = request.headers.get("authorization", "")

        if header.lower().startswith("basic "):
            try:
                decoded = base64.b64decode(header[6:]).decode("utf-8")
            except Exception:
                decoded = ""

            user, _, password = decoded.partition(":")

            if secrets.compare_digest(
                user.encode(), APP_USERNAME.encode()
            ) and secrets.compare_digest(
                password.encode(), APP_PASSWORD.encode()
            ):
                return await call_next(request)

        return Response(
            "Login required",
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="OSM Spreadsheet"'},
        )


app.add_middleware(BasicAuthMiddleware)

# Mapping validation endpoint: /api/validate
app.include_router(validate_router)

# Logic validation endpoint: /api/logic-validate
app.include_router(logic_router)

# XML -> table endpoint: /api/xml-table
app.include_router(xml_table_router)

app.mount(
    "/static",
    StaticFiles(directory=FRONTEND_DIR),
    name="static",
)


class ProcessRequest(BaseModel):
    data: str
    record_separator: str = "auto"
    field_separator: str = "auto"
    custom_record_separator: str = ""
    custom_field_separator: str = ""


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.post("/api/process")
def process(request: ProcessRequest):
    try:
        records, _, field_separator = parse_records(
            request.data,
            record_separator=request.record_separator,
            field_separator=request.field_separator,
            custom_record_separator=request.custom_record_separator,
            custom_field_separator=request.custom_field_separator,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    # Dropdown ki "tab" jaisi values ko asli character me badlo
    separator_names = {
        "pipe": "|",
        "tilde": "~",
        "tab": "\t",
        "semicolon": ";",
        "comma": ",",
    }
    field_separator = separator_names.get(field_separator, field_separator)

    mapped = map_records(records, field_separator=field_separator)
    checks = validate_rows(mapped["rows"])

    return {
        "columns": mapped["columns"],
        "rows": mapped["rows"],
        "record_count": len(mapped["rows"]),
        "employee_count": mapped["employee_count"],
        "dependent_count": mapped["dependent_count"],
        "errors": checks["errors"],
        "warnings": checks["warnings"],
    }
