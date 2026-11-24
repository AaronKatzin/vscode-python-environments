from django.contrib import admin
from django.http import HttpRequest, HttpResponse
from django.urls import path


def root(_request: HttpRequest) -> HttpResponse:
    return HttpResponse("Hello, World!")


urlpatterns = [
    path("", root, name="root"),
    path("admin/", admin.site.urls),
]
