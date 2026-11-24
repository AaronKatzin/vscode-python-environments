# Copilot Instructions for <package_name>

-   The Flask project `<package_name>` is a Python Project located in the folder `<package_name>_project`.
-   You need to call the `Get Python Environment Information` tool on the `<package_name>_project` path to get the Python executable details.
-   Substitute the Python executable you get from the `Get Python Environment Information` tool anywhere you see `<python>` in these instructions.
    -   Run command for `<package_name>`: `<python> -m flask --app <package_name>.main:app run`
    -   Command to run tests for `<package_name>`: `<python> -m pytest`
-   To run an editable install for the package `<package_name>`, use the `Install Python Package` tool with the `<package_name>_project` path and arguments `['-e', '.']`.
-   In the workspace `launch.json` file, configurations related to this project have the prefix `Python: Flask (<package_name>)`.
-   The project `<package_name>` has a defined `pyproject.toml` file that you should use and keep up to date. Runtime dependencies include Flask.
