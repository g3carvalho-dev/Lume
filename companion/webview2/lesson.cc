#include <windows.h>
#include <wrl.h>
#include <node_api.h>
#include <WebView2.h>
#include <memory>
#include <string>
#include <vector>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

struct Event {
  std::string type;
  std::wstring value;
  int id;
};

struct Lesson {
  HWND surface = nullptr;
  ComPtr<ICoreWebView2Controller> controller;
  ComPtr<ICoreWebView2> view;
  std::vector<Event> events;
  bool closed = false;

  void emit(const char* type, const wchar_t* value = L"", int id = 0) {
    if (!closed) events.push_back({type, value ? value : L"", id});
  }
  void close() {
    if (closed) return;
    closed = true;
    if (controller) controller->Close();
    view.Reset();
    controller.Reset();
    if (surface) DestroyWindow(surface);
    surface = nullptr;
    events.clear();
  }
};

static bool https(const wchar_t* uri) {
  return uri && _wcsnicmp(uri, L"https://", 8) == 0;
}

static HRESULT attach(const std::shared_ptr<Lesson>& lesson, ICoreWebView2Controller* controller) {
  lesson->controller = controller;
  HRESULT hr = controller->get_CoreWebView2(&lesson->view);
  if (FAILED(hr)) return hr;
  ComPtr<ICoreWebView2Settings> settings;
  if (FAILED(hr = lesson->view->get_Settings(&settings))) return hr;
  settings->put_AreHostObjectsAllowed(FALSE);
  settings->put_IsWebMessageEnabled(FALSE);
  settings->put_AreDevToolsEnabled(FALSE);
  EventRegistrationToken token{};
  auto view = lesson->view;
  // A WebView possui os callbacks. Referências fracas permitem fechar a janela
  // mesmo se uma navegação ou criação de documento estiver em andamento.
  std::weak_ptr<Lesson> weak = lesson;
  hr = view->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
    [weak](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
      LPWSTR uri = nullptr;
      args->get_Uri(&uri);
      if (!https(uri)) args->put_Cancel(TRUE);
      else if (auto s = weak.lock()) s->emit("navigating");
      CoTaskMemFree(uri);
      return S_OK;
    }).Get(), &token);
  if (FAILED(hr)) return hr;
  view->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
    [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) {return args->put_Handled(TRUE);}
  ).Get(), &token);
  ComPtr<ICoreWebView2_4> v4;
  if (FAILED(hr = view.As(&v4))) return hr;
  v4->add_DownloadStarting(Callback<ICoreWebView2DownloadStartingEventHandler>(
    [](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) {return args->put_Cancel(TRUE);}
  ).Get(), &token);
  view->add_SourceChanged(Callback<ICoreWebView2SourceChangedEventHandler>(
    [weak](ICoreWebView2* sender, ICoreWebView2SourceChangedEventArgs*) -> HRESULT {
      LPWSTR uri = nullptr;
      if (SUCCEEDED(sender->get_Source(&uri)) && uri) {
        // Parâmetros de retorno do login ficam no WebView2.
        std::wstring address(uri);
        address = address.substr(0, address.find_first_of(L"?#"));
        if (auto s = weak.lock()) s->emit("source", address.c_str());
      }
      CoTaskMemFree(uri);
      return S_OK;
    }).Get(), &token);
  v4->add_DOMContentLoaded(Callback<ICoreWebView2DOMContentLoadedEventHandler>(
    [weak](ICoreWebView2*, ICoreWebView2DOMContentLoadedEventArgs*) -> HRESULT {
      if (auto s = weak.lock()) s->emit("document");
      return S_OK;
    }).Get(), &token);
  view->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>(
    [weak](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
      BOOL ok = FALSE;
      COREWEBVIEW2_WEB_ERROR_STATUS status;
      if (SUCCEEDED(args->get_IsSuccess(&ok)) && !ok && SUCCEEDED(args->get_WebErrorStatus(&status))
          && status != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED)
        if (auto s = weak.lock()) s->emit("load-error");
      return S_OK;
    }).Get(), &token);
  view->add_ContainsFullScreenElementChanged(Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>(
    [weak](ICoreWebView2* sender, IUnknown*) -> HRESULT {
      BOOL active = FALSE;
      sender->get_ContainsFullScreenElement(&active);
      if (auto s = weak.lock()) s->emit("fullscreen", active ? L"on" : L"off");
      return S_OK;
    }).Get(), &token);
  view->add_ProcessFailed(Callback<ICoreWebView2ProcessFailedEventHandler>(
    [weak](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
      COREWEBVIEW2_PROCESS_FAILED_KIND kind;
      if (SUCCEEDED(args->get_ProcessFailedKind(&kind)) && kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED)
        if (auto s = weak.lock()) s->emit("unavailable");
      return S_OK;
    }).Get(), &token);
  lesson->emit("ready");
  return S_OK;
}

using Handle = std::shared_ptr<Lesson>;

static std::wstring stringArg(napi_env env, napi_value value) {
  size_t size = 0;
  napi_get_value_string_utf16(env, value, nullptr, 0, &size);
  std::wstring text(size + 1, L'\0');
  napi_get_value_string_utf16(env, value, reinterpret_cast<char16_t*>(text.data()), text.size(), &size);
  text.resize(size);
  return text;
}

static napi_value open(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2]{};
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  uint64_t hwnd = 0;
  bool exact = false;
  if (count != 2 || napi_get_value_bigint_uint64(env,args[0],&hwnd,&exact) != napi_ok || !exact ||
      !IsWindow(reinterpret_cast<HWND>(hwnd))) {
    napi_throw_error(env,nullptr,"Janela inválida."); return nullptr;
  }
  auto lesson = std::make_shared<Lesson>();
  // A superfície irmã do Chromium mantém a aula acima da página do Lume.
  lesson->surface = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
    0, 0, 0, 0, reinterpret_cast<HWND>(hwnd), nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!lesson->surface) { napi_throw_error(env,nullptr,"Falha ao criar a superfície do player."); return nullptr; }
  auto profile = stringArg(env,args[1]);
  const HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr,profile.c_str(),nullptr,
    Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
      [lesson](HRESULT status, ICoreWebView2Environment* environment) -> HRESULT {
        if (lesson->closed) return S_OK;
        if (SUCCEEDED(status) && environment)
          status = environment->CreateCoreWebView2Controller(lesson->surface, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [lesson](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
              if (lesson->closed) { if (controller) controller->Close(); return S_OK; }
              if (FAILED(result) || !controller || FAILED(attach(lesson,controller))) lesson->emit("unavailable");
              return S_OK;
            }).Get());
        if (FAILED(status)) lesson->emit("unavailable");
        return S_OK;
      }).Get());
  if (FAILED(hr)) { lesson->close(); napi_throw_error(env,nullptr,"Falha ao iniciar o runtime WebView2."); return nullptr; }
  napi_value handle;
  napi_create_external(env, new Handle(lesson), [](napi_env,void* data,void*) {
    auto handle = static_cast<Handle*>(data);
    (*handle)->close();
    delete handle;
  }, nullptr, &handle);
  return handle;
}

static napi_value dispatch(napi_env env, napi_callback_info info) {
  size_t count = 6;
  napi_value args[6]{};
  void* method = nullptr;
  napi_get_cb_info(env,info,&count,args,nullptr,&method);
  void* data = nullptr;
  if (!count || napi_get_value_external(env,args[0],&data) != napi_ok) {
    napi_throw_error(env,nullptr,"Player inválido."); return nullptr;
  }
  const auto& lesson = *static_cast<Handle*>(data);
  const std::string name(static_cast<const char*>(method));
  if (name == "close") lesson->close();
  if (name == "drain") {
    napi_value output;
    napi_create_array_with_length(env,lesson->events.size(),&output);
    uint32_t index = 0;
    for (const auto& e : lesson->events) {
      napi_value row, type, value, id;
      napi_create_object(env,&row);
      napi_create_string_utf8(env,e.type.c_str(),e.type.size(),&type);
      napi_create_string_utf16(env,reinterpret_cast<const char16_t*>(e.value.data()),e.value.size(),&value);
      napi_create_int32(env,e.id,&id);
      napi_set_named_property(env,row,"type",type);
      napi_set_named_property(env,row,"value",value);
      napi_set_named_property(env,row,"id",id);
      napi_set_element(env,output,index++,row);
    }
    lesson->events.clear();
    return output;
  }
  if (!lesson->closed && lesson->view) {
    if (name == "bounds" && count == 5) {
      int32_t box[4]{};
      for (int i=0;i<4;++i) napi_get_value_int32(env,args[i+1],&box[i]);
      SetWindowPos(lesson->surface, HWND_TOP, box[0], box[1], box[2], box[3], SWP_NOACTIVATE | SWP_SHOWWINDOW);
      RECT rect{0,0,box[2],box[3]};
      lesson->controller->put_Bounds(rect);
      lesson->controller->put_IsVisible(TRUE);
    }
    if (name == "navigate" && count == 2) lesson->view->Navigate(stringArg(env,args[1]).c_str());
    if (name == "cdp" && count == 4) {
      int32_t id = 0;
      napi_get_value_int32(env,args[1],&id);
      auto methodName = stringArg(env,args[2]), params = stringArg(env,args[3]);
      std::weak_ptr<Lesson> weak = lesson;
      auto hr = lesson->view->CallDevToolsProtocolMethod(methodName.c_str(),params.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
          [weak,id](HRESULT result,LPCWSTR json) -> HRESULT {
            if (auto s = weak.lock()) s->emit(SUCCEEDED(result) ? "result" : "error",json,id);
            return S_OK;
          }).Get());
      if (FAILED(hr)) lesson->emit("error",L"",id);
    }
  }
  return nullptr;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env,"open",NAPI_AUTO_LENGTH,open,nullptr,&fn);
  napi_set_named_property(env,exports,"open",fn);
  for (const char* name : {"bounds","navigate","cdp","drain","close"}) {
    napi_create_function(env,name,NAPI_AUTO_LENGTH,dispatch,const_cast<char*>(name),&fn);
    napi_set_named_property(env,exports,name,fn);
  }
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
