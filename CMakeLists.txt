cmake_minimum_required(VERSION 3.16)
project(currency_arbitrage LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(arbitrage_core STATIC
    src/graph.cpp
    src/detector.cpp
    src/cycle.cpp
    src/data_io.cpp
)
target_include_directories(arbitrage_core PUBLIC include)

add_executable(arbitrage src/main.cpp)
add_executable(arbitrage_web web/bridge.cpp)
target_link_libraries(arbitrage PRIVATE arbitrage_core)
target_link_libraries(arbitrage_web PRIVATE arbitrage_core)

foreach(target arbitrage_core arbitrage arbitrage_web)
    if(MSVC)
        target_compile_options(${target} PRIVATE /W4 /utf-8)
    else()
        target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
    endif()
endforeach()
