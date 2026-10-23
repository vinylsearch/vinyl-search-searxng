# syntax=docker/dockerfile:1
FROM searxng/searxng:2026.10.17-1c10abe2d@sha256:8bdd9aa136b2dc3b9332cf24714fa34a375b8a1949a1201ec900c24d7378596e

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

COPY settings.yml /etc/searxng/settings.yml

# The pinned Result Hunter parser joins every anchor in a result card, which
# produces invalid URLs when a card includes sitelinks. Select its headline.
# Fail on upstream drift so a future image update must review this patch.
RUN /usr/local/searxng/.venv/bin/python <<'RESULT_HUNTER_PATCH'
from pathlib import Path

path = Path("/usr/local/searxng/searx/engines/resulthunter.py")
source = path.read_text()
replacements = {
    'url = extract_text(eval_xpath(result, ".//a/@href"))':
        'url = extract_text(eval_xpath(result, "(.//a[.//h3]/@href)[1]"))',
    'title=extract_text(eval_xpath(result, ".//a/h3")) or "",':
        'title=extract_text(eval_xpath(result, "(.//a//h3)[1]")) or "",',
}
for old, new in replacements.items():
    assert source.count(old) == 1, "Result Hunter parser changed; review patch"
    source = source.replace(old, new)
path.write_text(source)
# The upstream image ships unchecked-hash bytecode, which otherwise keeps
# executing the original parser even after its source file changes.
for cached in (path.parent / "__pycache__").glob("resulthunter.*.pyc"):
    cached.unlink()
RESULT_HUNTER_PATCH

# Exercise the actual installed engine and merged production configuration.
COPY tests/test_resulthunter.py /tmp/test_resulthunter.py
RUN PYTHONPATH=/usr/local/searxng /usr/local/searxng/.venv/bin/python /tmp/test_resulthunter.py && rm /tmp/test_resulthunter.py

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
