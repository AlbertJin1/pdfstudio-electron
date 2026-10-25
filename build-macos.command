#!/bin/bash
cd "$(dirname "$0")"
chmod +x ./build-macos.sh
./build-macos.sh
printf "\nBuild finished. Press Return to close."
read -r
