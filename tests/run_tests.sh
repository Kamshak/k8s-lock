#!/usr/bin/env bash

set -e

source tests/k8s-euft/env.bash

yarn
yarn test

echo "All tests passed :)"
