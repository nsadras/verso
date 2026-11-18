import logging
import sys

from uvicorn.logging import DefaultFormatter

import main
from backend import provider  # noqa: F401 — install the same logging filters as startup


def test_startup_log_formats_address_after_provider_import_in_a_terminal(monkeypatch):
    monkeypatch.setattr(sys.stdout, "isatty", lambda: True)
    monkeypatch.setattr(sys.stderr, "isatty", lambda: True)
    output = []

    def run(app, **options):
        logger = logging.getLogger("uvicorn.error")
        message = "Uvicorn running on %s://%s:%d (Press CTRL+C to quit)"
        record = logger.makeRecord(
            logger.name, logging.INFO, __file__, 0, message,
            ("http", options["host"], options["port"]), None,
            extra={"color_message": message},
        )
        assert logger.filter(record)
        formatter = DefaultFormatter("%(levelprefix)s %(message)s", use_colors=options.get("use_colors"))
        output.append(formatter.format(record))

    monkeypatch.setattr(main.uvicorn, "run", run)
    main.main()
    assert output == ["INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)"]
