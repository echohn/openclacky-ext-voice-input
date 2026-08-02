# Changelog

所有重要变更记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.1] - 2026-08-02
### Added
- 按钮垂直位置设置（composer_align）：改回默认样式以与其他扩展按钮保持一致，支持在设置面板选择靠上/居中/靠下，控制语音输入按钮在输入框区域内的垂直对齐方式
- 加载顺序设置（composer_order）：仅当多个扩展共同占用输入框区域时生效，用于控制按钮左右排列顺序，数字越大越靠右，单一扩展场景下此设置不生效，需刷新页面后生效

### Changed
- 语音输入按钮改为 OpenClacky 默认样式，与其他扩展按钮保持一致
- README 重构为快速上手指南，新增中英双语链接

## [0.1.0] - 2026-07-30
### Added
- 初始版本发布
- 实时语音识别（浏览器原生 ASR + DashScope Paraformer 双引擎）
- 点击发送与连续对话两种模式
- 全局快捷键控制
- 退出词检测
- 多会话隔离
- 自定义音效
- 可视化设置面板
- 中英双语界面
- 用户使用文档 README.md
