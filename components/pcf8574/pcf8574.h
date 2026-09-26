// SPDX-License-Identifier: GPL-3.0-or-later

#pragma once

#include "esphome/core/component.h"
#include "esphome/core/hal.h"
#include "esphome/components/i2c/i2c.h"
#include "esphome/components/gpio_expander/cached_gpio.h"

namespace esphome::pcf8574 {

class PCF8574Component final : public Component,
                               public i2c::I2CDevice,
                               public gpio_expander::CachedGpioExpander<uint16_t, 16> {
 public:
  PCF8574Component() = default;
  void set_pcf8575(bool pcf8575) { pcf8575_ = pcf8575; }
  void set_interrupt_pin(InternalGPIOPin *pin) { this->interrupt_pin_ = pin; }
  void setup() override;
  void loop() override;
  void pin_mode(uint8_t pin, gpio::Flags flags);
  float get_setup_priority() const override;
  void dump_config() override;

 protected:
  static void IRAM_ATTR gpio_intr(PCF8574Component *arg);
  bool digital_read_hw(uint8_t pin) override;
  bool digital_read_cache(uint8_t pin) override;
  void digital_write_hw(uint8_t pin, bool value) override;
  bool read_gpio_();
  bool write_gpio_();
  void verify_outputs_(uint32_t delay_ms);
  static const char *error_name_(i2c::ErrorCode error);

  uint16_t mode_mask_{0x00};
  uint16_t output_mask_{0x00};
  uint16_t input_mask_{0x00};
  bool pcf8575_;
  InternalGPIOPin *interrupt_pin_{nullptr};
};

class PCF8574GPIOPin final : public GPIOPin {
 public:
  void setup() override;
  void pin_mode(gpio::Flags flags) override;
  bool digital_read() override;
  void digital_write(bool value) override;
  size_t dump_summary(char *buffer, size_t len) const override;
  void set_parent(PCF8574Component *parent) { parent_ = parent; }
  void set_pin(uint8_t pin) { pin_ = pin; }
  void set_inverted(bool inverted) { inverted_ = inverted; }
  void set_flags(gpio::Flags flags) { flags_ = flags; }
  gpio::Flags get_flags() const override { return this->flags_; }

 protected:
  PCF8574Component *parent_;
  uint8_t pin_;
  bool inverted_;
  gpio::Flags flags_;
};

}  // namespace esphome::pcf8574
