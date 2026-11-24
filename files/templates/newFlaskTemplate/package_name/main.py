from flask import Flask

app = Flask(__name__)


@app.route("/")
def root() -> str:
    return "Hello, World!"
