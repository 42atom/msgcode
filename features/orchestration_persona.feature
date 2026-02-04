Feature: Orchestration - Persona (v2.2)

  Scenario: Switch persona updates workspace config
    Given a clean workspace root
    And I bind chat "any;+;bdd-persona" to workspace "acme/ops"
    And workspace "acme/ops" has persona "coder" with content:
      """
      # Expert Coder

      You are an expert software engineer. Be concise.
      """
    When I run route command "/persona list" for chat "any;+;bdd-persona"
    Then the command should succeed
    And the output should contain "coder"
    When I run route command "/persona use coder" for chat "any;+;bdd-persona"
    Then the command should succeed
    And the output should contain "已切换到 persona: coder"
    When I run route command "/persona current" for chat "any;+;bdd-persona"
    Then the command should succeed
    And the output should contain "当前 persona: coder"

