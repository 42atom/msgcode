Feature: Orchestration - Schedules (v2.2)

  Scenario: Enable schedule then /reload maps it into jobs.json
    Given a clean workspace root
    And I bind chat "any;+;bdd-schedule" to workspace "acme/ops"
    And workspace "acme/ops" has schedule "morning" with json:
      """
      {
        "version": 1,
        "enabled": false,
        "tz": "Asia/Shanghai",
        "cron": "0 9 * * 1-5",
        "message": "早上好！今天有什么计划？",
        "delivery": { "mode": "reply-to-same-chat", "maxChars": 2000 }
      }
      """
    When I run route command "/schedule validate" for chat "any;+;bdd-schedule"
    Then the command should succeed
    And the output should contain "morning"
    When I run route command "/schedule enable morning" for chat "any;+;bdd-schedule"
    Then the command should succeed
    When I run route command "/reload" for chat "any;+;bdd-schedule"
    Then the command should succeed
    And jobs.json should contain a schedule job for workspace "acme/ops" and schedule "morning"

