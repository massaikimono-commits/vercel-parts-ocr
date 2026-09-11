# P2 local PP-StructureV3 PoC

This evaluation-only service accepts one image in memory, runs PP-StructureV3 with `PP-OCRv5_server_rec`, returns the bakeoff prediction contract, and does not write the upload or OCR output to disk.

## Local run

Use Python 3.10 or 3.11 in an isolated virtual environment.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
ICB_P2_ALLOWED_ORIGINS=http://localhost:3000 uvicorn app:app --host 127.0.0.1 --port 8765
```

For another device on the same LAN, bind explicitly to the computer's private LAN address and list the exact browser origin in `ICB_P2_ALLOWED_ORIGINS`. Do not expose the service to the public internet. An HTTPS page cannot call an HTTP LAN endpoint because browsers block mixed content; the PoC therefore uses a same-machine HTTP origin for local development. iPhone testing requires a separately approved trusted-LAN HTTPS or localhost-bridge design.

The first start downloads model weights. No paid API or managed OCR service is used. Model weights are not user images.
