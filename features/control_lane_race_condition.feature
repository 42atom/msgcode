Feature: Control Lane - Race Condition Prevention (v2.2)

  Background:
    Given a clean workspace root
    And I bind chat "any;+;bdd-race" to workspace "acme/ops"

  Scenario: Queue lane skips processing when fast lane is in-flight
    Given I have mocked the imsg send with a 200ms delay
    When I send message "/status" to chat "any;+;bdd-race"
    And I immediately process the queue lane for the same message
    Then the message should be replied to exactly 1 time

  Scenario: Fast lane in-flight status prevents queue lane duplicate
    Given I have mocked the imsg send with a 200ms delay
    When I send message "/where" to chat "any;+;bdd-race"
    And I immediately process the queue lane for the same message
    Then the message should be replied to exactly 1 time
