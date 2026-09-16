#!/usr/bin/env python3
"""WardriveDB server — thin shim so `python server.py` keeps working.

The real implementation lives in the `wardrivedb` package:
    python -m wardrivedb
"""
from wardrivedb.server import main

if __name__ == "__main__":
    main()