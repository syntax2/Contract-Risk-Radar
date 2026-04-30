#include <unity.h>

#define UNIT_TEST
#include "../src/main.cpp"

void test_tou_wraps_midnight() {
  TEST_ASSERT_TRUE(isCheapHour(22, 22, 6));
  TEST_ASSERT_TRUE(isCheapHour(5, 22, 6));
  TEST_ASSERT_FALSE(isCheapHour(12, 22, 6));
}

void test_acs712_midpoint_is_zero_current() {
  const float amps = computeAcsCurrentFromAdc(2048, 3.3f, 4095, 1.65f, 0.1221f);
  TEST_ASSERT_FLOAT_WITHIN(0.02f, 0.0f, amps);
}

void test_acs712_positive_current_from_adc_delta() {
  const float amps = computeAcsCurrentFromAdc(2200, 3.3f, 4095, 1.65f, 0.1221f);
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 1.0f, amps);
}

void test_integrate_wh_for_10_second_sample() {
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, integrateWh(360.0f, 10));
}

void test_forecast_greenlights_rising_solar() {
  RuntimeConfig cfg = {22, 6, 500.0f, "", ""};
  EnergySample history[6] = {
      {200, 420, 0.55f, 1.10f, 1},
      {210, 430, 0.58f, 1.15f, 2},
      {220, 440, 0.61f, 1.20f, 3},
      {230, 450, 0.64f, 1.25f, 4},
      {240, 460, 0.67f, 1.30f, 5},
      {250, 470, 0.69f, 1.35f, 6},
  };
  const DeviceDecision decision = decideLoadShift(history, 6, 350.0f, 850.0f, 2.60f, cfg, 23, 10);
  TEST_ASSERT_TRUE(decision.shiftLoad);
  TEST_ASSERT_EQUAL_STRING("shift_load", decision.action);
  TEST_ASSERT_TRUE(decision.devicesOn > 0);
  TEST_ASSERT_TRUE(decision.solarEstimate >= 0.65f);
}

void test_forecast_blocks_expensive_hour() {
  RuntimeConfig cfg = {22, 6, 500.0f, "", ""};
  EnergySample history[6] = {
      {200, 420, 0.55f, 1.10f, 1},
      {210, 430, 0.58f, 1.15f, 2},
      {220, 440, 0.61f, 1.20f, 3},
      {230, 450, 0.64f, 1.25f, 4},
      {240, 460, 0.67f, 1.30f, 5},
      {250, 470, 0.69f, 1.35f, 6},
  };
  const DeviceDecision decision = decideLoadShift(history, 6, 350.0f, 850.0f, 2.60f, cfg, 14, 10);
  TEST_ASSERT_FALSE(decision.shiftLoad);
  TEST_ASSERT_EQUAL(0, decision.devicesOn);
  TEST_ASSERT_EQUAL_STRING("idle", decision.action);
}

int main(int argc, char **argv) {
  UNITY_BEGIN();
  RUN_TEST(test_tou_wraps_midnight);
  RUN_TEST(test_acs712_midpoint_is_zero_current);
  RUN_TEST(test_acs712_positive_current_from_adc_delta);
  RUN_TEST(test_integrate_wh_for_10_second_sample);
  RUN_TEST(test_forecast_greenlights_rising_solar);
  RUN_TEST(test_forecast_blocks_expensive_hour);
  return UNITY_END();
}
