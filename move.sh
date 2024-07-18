#!/bin/bash

# Check if a directory name is provided as an argument
if [ -z "$1" ]; then
  echo "Please provide the directory name as a command line argument."
  exit 1
fi

# Get the directory name from the command line argument
DIR="$1"

# Check if the specified directory exists
if [ ! -d "$DIR" ]; then
  echo "The specified directory does not exist."
  exit 1
fi

# Initialize counters
html_moved=0
css_moved=0

# Move HTML files up one level
for file in "$DIR"/*.html; do
  if [ -e "$file" ]; then
    mv "$file" "$(dirname "$DIR")"
    html_moved=1
  fi
done

# Move CSS files up one level
for file in "$DIR"/*.css; do
  if [ -e "$file" ]; then
    mv "$file" "$(dirname "$DIR")"
    css_moved=1
  fi
done

# Print out whether HTML and CSS files were moved
if [ $html_moved -eq 1 ]; then
  echo "HTML files were moved."
else
  echo "No HTML files were found to move."
fi

if [ $css_moved -eq 1 ]; then
  echo "CSS files were moved."
else
  echo "No CSS files were found to move."
fi

