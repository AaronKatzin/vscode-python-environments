import os

import django
from django.test import Client

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "package_name.settings")
django.setup()

client = Client()


def test_read_root() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.content == b"Hello, World!"
