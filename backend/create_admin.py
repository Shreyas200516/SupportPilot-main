"""Create the first SupportPilot administrator from the local command line."""

import argparse
import getpass
import sys
from pathlib import Path

from pydantic import TypeAdapter

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import auth, database  # noqa: E402
from app.config import DATABASE_PATH  # noqa: E402
from app.schemas import EmailStr  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision the first SupportPilot admin account.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()

    try:
        email = str(TypeAdapter(EmailStr).validate_python(args.email))
    except Exception as exc:
        parser.error(f"Invalid email address: {exc}")

    database.initialize(DATABASE_PATH)
    if any(user["role"] == "admin" for user in database.list_users(DATABASE_PATH)):
        parser.error("An administrator already exists. Ask an administrator to create additional accounts.")

    password = getpass.getpass("Choose an admin password (at least 12 characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if len(password) < 12:
        parser.error("Password must contain at least 12 characters.")
    if password != confirmation:
        parser.error("Passwords do not match.")

    database.create_user(
        DATABASE_PATH,
        email.casefold(),
        args.name,
        auth.hash_password(password),
        "admin",
    )
    print(f"Administrator account created for {email}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
