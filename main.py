import uvicorn


def main():
    # LiteLLM's log redaction consumes arguments used by Uvicorn's colored messages.
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, workers=1, use_colors=False)


if __name__ == "__main__":
    main()
