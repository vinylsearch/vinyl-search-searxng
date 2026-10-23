# syntax=docker/dockerfile:1
FROM searxng/searxng@sha256:4d5f763fc369ec448be6e7ca1464275ee5d50851dbfd38edb29694bc87f027c2

# Keep the existing SearXNG release; patch its bundled CA certificates.
# The minimal upstream image has no OS package manager. Use its Python
# bootstrap installer temporarily, then remove pip from the runtime again.
RUN <<'INSTALL'
set -eu
/usr/local/searxng/.venv/bin/python -m ensurepip --upgrade
/usr/local/searxng/.venv/bin/python -m pip install --no-cache-dir --no-deps --require-hashes -r /dev/stdin <<'REQUIREMENTS'
certifi==2026.10.19 --hash=sha256:42d35340cc5b9ba78e818ddbff0c5b1c2b779de448a340fd1b989f5fa8670e1b
REQUIREMENTS
/usr/local/searxng/.venv/bin/python -m pip uninstall --yes pip
INSTALL

# Rebuild the system bundle AND hashed certificate directory from the patched
# Mozilla trust set. The upstream entrypoint can safely regenerate these files.
RUN /usr/local/searxng/.venv/bin/python <<'CERTIFICATES'
import importlib.metadata
import pathlib
import re
import ssl
import subprocess
import certifi

assert importlib.metadata.version("certifi") == "2026.10.19"
certificates = re.findall(
    r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
    pathlib.Path(certifi.where()).read_text(),
    re.S,
)
assert len(certificates) > 100, "Incomplete CA bundle"
directory = pathlib.Path("/usr/share/ca-certificates/rillenradar")
directory.mkdir(parents=True, exist_ok=True)
entries = []
for index, certificate in enumerate(certificates):
    name = f"mozilla-{index:03d}.crt"
    (directory / name).write_text(certificate + "\n")
    entries.append(f"rillenradar/{name}")
pathlib.Path("/etc/ca-certificates.conf").write_text("\n".join(entries) + "\n")
subprocess.run(["update-ca-certificates", "--fresh"], check=True)
# Repeat the upstream startup operation to ensure removed roots stay removed.
subprocess.run(["update-ca-certificates"], check=True)
expected = {ssl.PEM_cert_to_DER_cert(certificate) for certificate in certificates}
actual = set(ssl.create_default_context().get_ca_certs(binary_form=True))
assert actual == expected, "System trust store differs from patched certifi"
print(f"CA verification passed: certifi 2026.10.19, {len(expected)} trusted roots")
CERTIFICATES

# This service previously used the upstream image directly. Keep its default
# settings and runtime environment instead of copying the main search config.

# Fail the build if the application's own HTTP client still accepts either
# compromised test chain. DNS failures/timeouts are not treated as a pass.
RUN /usr/local/searxng/.venv/bin/python <<'TLS_TEST'
import asyncio
from curl_cffi import CurlError
from searx.network.client import new_client

async def verify_tls():
    async with new_client(
        enable_http=False,
        verify=True,
        enable_http2=True,
        enable_http3=False,
        max_connections=2,
        proxies={},
        local_address=None,
        max_redirects=0,
    ) as client:
        response = await client.get("https://pypi.org/", timeout=15)
        assert response.status_code == 200, "Valid HTTPS control request failed"
        for hostname in (
            "dv-g3b-emudhra.we-have-a-problem.com",
            "dv-g3b-aaa-emudhra.we-have-a-problem.com",
        ):
            try:
                await client.get(f"https://{hostname}/", timeout=15)
            except CurlError as error:
                if int(error.code) != 60:
                    raise
                print(f"PASS: certificate rejected for {hostname}")
            else:
                raise RuntimeError(f"Compromised certificate accepted: {hostname}")
    print("SearXNG HTTPS certificate checks passed")

asyncio.run(verify_tls())
TLS_TEST
