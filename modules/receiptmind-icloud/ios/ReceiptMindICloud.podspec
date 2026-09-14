Pod::Spec.new do |s|
  s.name = 'ReceiptMindICloud'
  s.version = '0.1.0'
  s.summary = 'ReceiptMind iCloud original receipt provider'
  s.description = 'Private app-local bridge for coordinated iCloud Drive documents.'
  s.license = { :type => 'MIT' }
  s.author = 'ReceiptMind'
  s.homepage = 'https://github.com/Shameem1111/scanreciept'
  s.source = { :git => 'https://github.com/Shameem1111/scanreciept.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
