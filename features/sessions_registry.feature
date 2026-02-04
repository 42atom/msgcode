Feature: tmux - Session Registry (v2.2)

  Scenario: lastStopAtMs is preserved across upsert cycles
    Given a session registry record exists for session "msgcode-default"
    When I mark the session "msgcode-default" as stopped
    And I upsert the same session "msgcode-default" again
    Then the session "msgcode-default" should have lastStopAtMs > 0

