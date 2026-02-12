Feature: Orchestration - Schedule Merge Strategy (v2.2)

  Scenario: /reload preserves manual jobs when merging schedules
    Given a clean workspace root
    And I bind chat "any;+;bdd-merge" to workspace "acme/ops"
    And jobs.json contains a manual job with id "manual:1"
    And workspace "acme/ops" has schedule "morning" with json:
      """
      {
        "version": 1,
        "enabled": true,
        "tz": "Asia/Shanghai",
        "cron": "0 9 * * 1-5",
        "message": "早上好！今天有什么计划？",
        "delivery": { "mode": "reply-to-same-chat", "maxChars": 2000 }
      }
      """
    When I run route command "/reload" for chat "any;+;bdd-merge"
    Then the command should succeed
    And jobs.json should contain job with id "manual:1"
    And jobs.json should contain a schedule job for workspace "acme/ops" and schedule "morning"
    And jobs.json should have at least 2 jobs
