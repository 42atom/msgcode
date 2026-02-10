#!/usr/bin/env bash
# msgcode: MLX Smoke Test Orchestration
#
# Executes all MLX probe scripts in sequence and generates a markdown report.
# Order: stop-server.sh → start-server.sh → check-health.sh → probe-basic.sh → probe-tool-role.sh → probe-tool-loop.sh
#
# Usage: ./scripts/mlx-lab/smoke-all.sh
# Output (preferred): artifacts/mlx-lab/results/smoke-run-YYYYMMDD-HHMM.md
# Output (legacy, if exists): AIDOCS/msgcode-2.2/mlx-lab/results/...

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Results directory
LEGACY_RESULTS_DIR="$PROJECT_ROOT/AIDOCS/msgcode-2.2/mlx-lab/results"
RESULTS_DIR="$PROJECT_ROOT/artifacts/mlx-lab/results"

if [ -d "$LEGACY_RESULTS_DIR" ]; then
  RESULTS_DIR="$LEGACY_RESULTS_DIR"
fi
TIMESTAMP=$(date +"%Y%m%d-%H%M")
RESULT_FILE="$RESULTS_DIR/smoke-run-$TIMESTAMP.md"

# Ensure results directory exists
mkdir -p "$RESULTS_DIR"

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
START_TIME=$(date +%s)

# Start markdown report
cat > "$RESULT_FILE" << 'EOF'
# MLX Smoke Test Report

> Automated smoke test execution for MLX LM Server validation
>
> Generated: TIMESTAMP_PLACEHOLDER

---

## Execution Summary

| Metric | Value |
|--------|-------|
| **Total Tests** | SUMMARY_TOTAL |
| **Passed** | SUMMARY_PASSED |
| **Failed** | SUMMARY_FAILED |
| **Pass Rate** | SUMMARY_RATE |

---

## Test Details

EOF

# Replace timestamp placeholder
sed -i '' "s/TIMESTAMP_PLACEHOLDER/$(date '+%Y-%m-%d %H:%M:%S')/" "$RESULT_FILE"

# Helper function to run a test and record results
run_test() {
    local test_name="$1"
    local test_script="$2"
    local expected_behavior="$3"
    local round_count="${4:-N/A}"

    echo "Running: $test_name..."

    # Add to total
    ((TOTAL_TESTS++))

    # Create markdown section for this test
    cat >> "$RESULT_FILE" << EOF

### $test_name

| Field | Content |
|-------|---------|
| **Test Name** | $test_name |
| **Script** | \`$test_script\` |
| **Rounds** | $round_count |
| **Expected Behavior** | $expected_behavior |
| **Status** | RUNNING |

EOF

    # Run the test and capture output
    if bash "$SCRIPT_DIR/$test_script" >> "$RESULT_FILE.tmp" 2>&1; then
        # Test passed
        ((PASSED_TESTS++))
        cat >> "$RESULT_FILE" << EOF

**Result:** ✅ PASSED

\`\`\`
$(cat "$RESULT_FILE.tmp" | head -20)
\`\`\`

EOF
    else
        # Test failed
        ((FAILED_TESTS++))
        cat >> "$RESULT_FILE" << EOF

**Result:** ❌ FAILED

\`\`\`
$(cat "$RESULT_FILE.tmp" | tail -30)
\`\`\`

**Error Log:**
\`\`\`
$(cat "$RESULT_FILE.tmp" | tail -50)
\`\`\`

EOF
    fi

    # Clean up temp file
    rm -f "$RESULT_FILE.tmp"
}

# Helper function to update summary
update_summary() {
    # Calculate pass rate
    local pass_rate="0%"
    if [ $TOTAL_TESTS -gt 0 ]; then
        local pass_percent=$((PASSED_TESTS * 100 / TOTAL_TESTS))
        pass_rate="${pass_percent}%"
    fi

    # Update summary in markdown
    sed -i '' "s/SUMMARY_TOTAL/$TOTAL_TESTS/" "$RESULT_FILE"
    sed -i '' "s/SUMMARY_PASSED/$PASSED_TESTS/" "$RESULT_FILE"
    sed -i '' "s/SUMMARY_FAILED/$FAILED_TESTS/" "$RESULT_FILE"
    sed -i '' "s/SUMMARY_RATE/$pass_rate/" "$RESULT_FILE"
}

# ============================================
# Test Sequence
# ============================================

echo "=========================================="
echo "MLX Smoke Test - Starting"
echo "=========================================="
echo ""

# Step 1: Stop server (ignore failure)
echo "[1/6] Stopping any existing MLX server..."
if bash "$SCRIPT_DIR/stop-server.sh" 2>/dev/null; then
    echo "  → Server stopped (or was not running)"
else
    echo "  → Stop failed (ignoring)"
fi
echo ""

# Step 2: Start server
echo "[2/6] Starting MLX server..."
run_test "Start MLX Server" \
    "start-server.sh" \
    "MLX server starts successfully and is ready to accept requests" \
    "N/A"

if [ $FAILED_TESTS -gt 0 ]; then
    cat >> "$RESULT_FILE" << EOF

---

## ❌ ABORTED

Server startup failed. Remaining tests skipped.

EOF
    # Update summary
    update_summary
    cat "$RESULT_FILE"
    exit 1
fi
echo ""

# Step 3: Health check
echo "[3/6] Checking server health..."
run_test "Health Check" \
    "check-health.sh" \
    "Server /v1/models endpoint returns 200 and valid model list" \
    "N/A"

if [ $FAILED_TESTS -gt 0 ]; then
    cat >> "$RESULT_FILE" << EOF

---

## ❌ ABORTED

Health check failed. Remaining tests skipped.

EOF
    # Update summary
    update_summary
    cat "$RESULT_FILE"
    exit 1
fi
echo ""

# Step 4: Basic probe
echo "[4/6] Testing basic responses..."
run_test "Basic Response Test" \
    "probe-basic.sh" \
    "5 rounds of simple prompts, each returning valid response (expected: 'OK')" \
    "5"
echo ""

# Step 5: Tool role probe
echo "[5/6] Testing tool role messages..."
run_test "Tool Role Test" \
    "probe-tool-role.sh" \
    "10 rounds testing tool role message handling and context preservation" \
    "10"
echo ""

# Step 6: Tool loop probe
echo "[6/6] Testing two-round tool loop..."
run_test "Tool Loop Test" \
    "probe-tool-loop.sh" \
    "10 rounds testing two-round tool call loop (assistant → tool → assistant)" \
    "10"
echo ""

# ============================================
# Finalize Report
# ============================================

# Update summary
update_summary

# Add final summary section
cat >> "$RESULT_FILE" << EOF

---

## Execution Information

| Field | Content |
|-------|---------|
| **Execution Date** | $(date '+%Y-%m-%d') |
| **Execution Time** | $(date '+%H:%M:%S') |
| **Script Version** | smoke-all.sh v1.0 |
| **Total Duration** | ~$(($(date +%s) - START_TIME)) seconds |

---

## Conclusion

EOF

if [ $FAILED_TESTS -eq 0 ]; then
    cat >> "$RESULT_FILE" << EOF
✅ **All tests passed!** MLX server is functioning correctly.
EOF
else
    cat >> "$RESULT_FILE" << EOF
❌ **Some tests failed.** Please review the error logs above and check:
- MLX server is running: \`bash scripts/mlx-lab/check-health.sh\`
- Model path is correct: \`MLX_MODEL_PATH\` environment variable
- Server logs: \`tail -f /tmp/mlx-lm-server.log\`
EOF
fi

# Close report
echo "" >> "$RESULT_FILE"
echo "---" >> "$RESULT_FILE"
echo "*Generated by msgcode MLX smoke test automation*" >> "$RESULT_FILE"

# ============================================
# Output Results
# ============================================

echo "=========================================="
echo "MLX Smoke Test - Complete"
echo "=========================================="
echo ""
echo "Results: $RESULT_FILE"
echo ""
echo "Summary:"
echo "  Total:  $TOTAL_TESTS"
echo "  Passed: $PASSED_TESTS"
echo "  Failed: $FAILED_TESTS"
echo ""

# Display report
cat "$RESULT_FILE"

# Exit with appropriate code
if [ $FAILED_TESTS -gt 0 ]; then
    exit 1
fi

exit 0
