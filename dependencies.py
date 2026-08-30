pip install ultralytics opencv-python

#----------------------------------------------------
#Use Python's built-in module launcher to bypass PATH environment variable issues where pip isn't recognized directly.
#Option 1: Run via Python Module (Recommended)

# Windows
python -m pip install ultralytics opencv-python

# Mac / Linux
python3 -m pip install ultralytics opencv-python

#Option 2: Try pip3 directly
pip3 install ultralytics opencv-python

#Common Fixes by Error Message
#'pip' is not recognized as an internal or external command... (Windows):
#Re-run your Python Windows installer, select Modify, and ensure Add Python to environment variables (or Add Python.exe to PATH) is checked.

#error: externally-managed-environment (Linux / macOS):
#Override system environment locks using the --break-system-packages flag:
python3 -m pip install ultralytics opencv-python --break-system-packages

#Permission denied / Access errors:
#Install packages specifically to your local user directory:
python -m pip install --user ultralytics opencv-python

# 1. Verify Python installation
python --version

# 2. Install required libraries
python -m pip install ultralytics opencv-python

# 3. Run your inspection script
python app.py

