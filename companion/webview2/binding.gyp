{
  "targets": [{
    "target_name": "lume_webview",
    "sources": ["lesson.cc"],
    "variables": {"sdk": "<(module_root_dir)/../node_modules/.cache/webview2-1.0.4314.35/sdk/build/native"},
    "include_dirs": ["<(sdk)/include"],
    "libraries": ["<(sdk)/x64/WebView2LoaderStatic.lib", "version.lib", "ole32.lib", "oleaut32.lib", "shlwapi.lib", "user32.lib", "advapi32.lib"],
    "defines": ["UNICODE", "_UNICODE", "NAPI_VERSION=8"],
    "msvs_settings": {"VCCLCompilerTool": {"AdditionalOptions": ["/utf-8"]}}
  }]
}
