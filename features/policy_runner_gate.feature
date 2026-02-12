Feature: Policy & Runner Gate (v2.2)

  Scenario: /policy local-only rejects /model codex with helpful hint
    Given a clean workspace root
    And I bind chat "any;+;bdd-policy" to workspace "acme/ops"
    When I run route command "/policy local-only" for chat "any;+;bdd-policy"
    Then the command should succeed
    And the output should contain "local-only"
    When I run route command "/model codex" for chat "any;+;bdd-policy"
    Then the command should fail
    And the output should contain "local-only"
    And the output should contain "/policy egress-allowed"
